package api

import (
	"context"
	"fmt"
	"time"

	"github.com/davisbrown/pull-up/server/internal/push"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// The streak nudge (phase 20) is the app's only unprompted "come play"
// notification, and it is deliberately narrow. It fires on a fact the
// player created themselves — a streak they built is about to lapse — not
// on manufactured urgency, and only inside a window where acting on it is
// still possible.
const (
	// nudgeMaxCandidatesPerRun bounds one cron tick's work.
	nudgeMaxCandidatesPerRun = 200
	// Local-time gate: evening, when someone could still go play, and late
	// enough in the week that the streak is genuinely at risk. Weekday
	// numbering is Go's (Sunday=0), and the streak week runs Monday-Sunday
	// to match Postgres date_trunc('week', …).
	nudgeHourStart = 17
	nudgeHourEnd   = 21
)

// nudgeEligible reports whether a candidate's local time is inside the
// nudge window: Thursday through Saturday evening. Sunday is excluded —
// the streak lapses at midnight and a nudge that late reads as taunting
// rather than helping.
func nudgeEligible(localNow time.Time) bool {
	switch localNow.Weekday() {
	case time.Thursday, time.Friday, time.Saturday:
	default:
		return false
	}
	h := localNow.Hour()
	return h >= nudgeHourStart && h < nudgeHourEnd
}

// streakNudgeBody renders the copy for a streak of n weeks. Kept honest:
// it states the streak the player actually has and how long is left, with
// no invented scarcity.
func streakNudgeBody(streak int, daysLeft int) string {
	unit := "days"
	if daysLeft == 1 {
		unit = "day"
	}
	return fmt.Sprintf("Your %d-week streak needs a run — %d %s left.", streak, daysLeft, unit)
}

// daysLeftInStreakWeek counts whole days from localNow to the end of its
// Monday-start week (Sunday inclusive), so Saturday evening reads "1 day
// left" rather than "0".
func daysLeftInStreakWeek(localNow time.Time) int {
	// Monday=0 … Sunday=6.
	idx := (int(localNow.Weekday()) + 6) % 7
	return 6 - idx + 1
}

// runStreakNudges is the cron pass: find players whose streak is alive but
// unplayed this week, and nudge the ones for whom it's currently evening.
// Called from the internal drain endpoint, so it inherits the 15-minute
// Cloudflare cron without new infrastructure.
func (s *Server) runStreakNudges(ctx context.Context) int {
	candidates, err := s.store.Queries.ListStreakNudgeCandidates(ctx, nudgeMaxCandidatesPerRun)
	if err != nil {
		s.log.Error("streak nudge candidates", "err", err)
		return 0
	}
	now := time.Now()
	sent := 0
	for _, c := range candidates {
		if c.Timezone == nil {
			continue
		}
		loc, err := time.LoadLocation(*c.Timezone)
		if err != nil {
			continue // an unusable stored zone silently opts them out
		}
		localNow := now.In(loc)
		if !nudgeEligible(localNow) {
			continue
		}

		// The exact streak length, from the same helper /me/stats uses, so
		// the number in the push matches the number on their profile.
		weeks, err := s.store.Queries.UserCheckInWeeks(ctx, gen.UserCheckInWeeksParams{
			UserID: c.UserID, TzOffsetMinutes: 0,
		})
		if err != nil {
			s.log.Error("streak nudge weeks", "user", c.UserID, "err", err)
			continue
		}
		starts := make([]time.Time, 0, len(weeks))
		for _, w := range weeks {
			if w.Valid {
				starts = append(starts, w.Time)
			}
		}
		streak := weekStreak(starts, mondayWeekStart(now))
		if streak <= 0 {
			continue // the streak died after all; say nothing
		}

		tokens, err := s.store.Queries.ListUserPushTokens(ctx, c.UserID)
		if err != nil || len(tokens) == 0 {
			continue
		}
		// Mark before sending: a push that fails is not worth retrying
		// into a double-notify, and the 6-day gate is the whole point.
		if err := s.store.Queries.MarkPlayNudgeSent(ctx, c.UserID); err != nil {
			s.log.Error("mark play nudge sent", "user", c.UserID, "err", err)
			continue
		}
		if err := push.Send(ctx, tokens,
			"Keep your streak alive",
			streakNudgeBody(streak, daysLeftInStreakWeek(localNow)),
			map[string]string{"action": "view_map"},
		); err != nil {
			s.log.Error("streak nudge push", "user", c.UserID, "err", err)
			continue
		}
		sent++
	}
	return sent
}
