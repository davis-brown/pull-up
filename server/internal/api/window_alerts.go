package api

import (
	"context"
	"fmt"
	"time"
	// Embed the tz database: window evaluation must work in the container
	// image regardless of the base image's zoneinfo.
	_ "time/tzdata"

	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/push"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// windowAlertThreshold is the live headcount (party-size aware) at which a
// court counts as having "a real run" worth interrupting someone for. The
// 0 → 1 favoriter ping (notifyRunStarted) covers the run *starting*; this
// alert fires only when it has clearly materialized.
const windowAlertThreshold = 4

// windowSpan mirrors the availability windows players pick in profile
// settings (app/lib/player.ts, validated in user_handlers.go). A test pins
// the keys to validAvailability so the two lists cannot drift.
type windowSpan struct {
	key     string
	weekend bool
	start   int // inclusive hour
	end     int // exclusive hour
	label   string
}

var windowSpans = []windowSpan{
	{key: "weekday_morning", weekend: false, start: 6, end: 11, label: "morning"},
	{key: "weekday_lunch", weekend: false, start: 11, end: 14, label: "lunch"},
	{key: "weekday_evening", weekend: false, start: 17, end: 22, label: "evening"},
	{key: "weekend_morning", weekend: true, start: 6, end: 12, label: "morning"},
	{key: "weekend_afternoon", weekend: true, start: 12, end: 17, label: "afternoon"},
	{key: "weekend_evening", weekend: true, start: 17, end: 22, label: "evening"},
}

// matchedWindowLabel reports the label of the first of the player's
// availability windows containing localNow, or "" when none does.
func matchedWindowLabel(availability []string, localNow time.Time) string {
	dow := localNow.Weekday()
	weekend := dow == time.Saturday || dow == time.Sunday
	hour := localNow.Hour()
	for _, span := range windowSpans {
		if span.weekend != weekend || hour < span.start || hour >= span.end {
			continue
		}
		for _, key := range availability {
			if key == span.key {
				return span.label
			}
		}
	}
	return ""
}

// validTimezone accepts only resolvable IANA zone names. "Local" is
// rejected: it means "wherever this server runs", never a player's zone.
func validTimezone(name string) bool {
	if name == "" || name == "Local" || len(name) > 64 {
		return false
	}
	_, err := time.LoadLocation(name)
	return err == nil
}

// notifyWindowAlerts pushes "a real run is on during your window" to eligible
// favoriters when this check-in carried the court's live headcount across the
// threshold. Fire-and-forget from the check-in handler; partySize is the
// just-created check-in's contribution, used to detect the crossing.
func (s *Server) notifyWindowAlerts(courtID, actor uuid.UUID, partySize int) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	count, err := s.store.Queries.CountActiveCheckIns(ctx, courtID)
	if err != nil {
		s.log.Error("window alert count", "court", courtID, "err", err)
		return
	}
	// Crossing-only: alert when this check-in pushed the count over the
	// threshold, never on the ones after — the wobble as players come and go
	// must not re-fire (the per-user cooldown is the second guard).
	if int(count) < windowAlertThreshold || int(count)-partySize >= windowAlertThreshold {
		return
	}

	candidates, err := s.store.Queries.ListWindowAlertCandidates(ctx, gen.ListWindowAlertCandidatesParams{
		CourtID: courtID, Actor: actor,
	})
	if err != nil {
		s.log.Error("window alert candidates", "court", courtID, "err", err)
		return
	}
	if len(candidates) == 0 {
		return
	}

	now := time.Now()
	// One push per window label so the copy can say which of their windows
	// this is; the label set is tiny (morning/lunch/afternoon/evening).
	tokensByLabel := map[string][]string{}
	var notified []uuid.UUID
	for _, cand := range candidates {
		if cand.Timezone == nil {
			continue
		}
		loc, err := time.LoadLocation(*cand.Timezone)
		if err != nil {
			continue // an invalid stored timezone silently opts them out
		}
		label := matchedWindowLabel(cand.Availability, now.In(loc))
		if label == "" {
			continue
		}
		tokensByLabel[label] = append(tokensByLabel[label], cand.Tokens...)
		notified = append(notified, cand.UserID)
	}
	if len(notified) == 0 {
		return
	}

	court, err := s.store.Queries.GetCourt(ctx, courtID)
	if err != nil {
		s.log.Error("window alert court", "court", courtID, "err", err)
		return
	}
	for label, tokens := range tokensByLabel {
		if err := push.Send(ctx, tokens,
			fmt.Sprintf("Now at %s: %d playing", court.Name, count),
			fmt.Sprintf("A run is on during your %s window.", label),
			map[string]string{"courtId": courtID.String()},
		); err != nil {
			s.log.Error("window alert push", "court", courtID, "err", err)
		}
	}
	// Record sends after the pushes: a failed Send still records, which
	// errs on the quiet side (cooldown applies) rather than re-pinging.
	for _, uid := range notified {
		if err := s.store.Queries.RecordWindowAlert(ctx, gen.RecordWindowAlertParams{
			UserID: uid, CourtID: courtID,
		}); err != nil {
			s.log.Error("record window alert", "user", uid, "err", err)
		}
	}
}
