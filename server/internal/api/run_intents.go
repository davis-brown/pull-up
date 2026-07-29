package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/davisbrown/pull-up/server/internal/push"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const (
	// intentThreshold is the seeker count that turns a bucket into a push.
	// Deliberately a separate constant from windowAlertThreshold, which
	// happens to share its value.
	intentThreshold = 4
	// maxIntentLeadDays bounds how far ahead a seeker can mark intent.
	maxIntentLeadDays = 7
)

// windowSpanByKey looks up a span by its availability key (see
// window_alerts.go for the table and the validAvailability tie-in).
func windowSpanByKey(key string) (windowSpan, bool) {
	for _, s := range windowSpans {
		if s.key == key {
			return s, true
		}
	}
	return windowSpan{}, false
}

func isWeekendDate(t time.Time) bool {
	dow := t.Weekday()
	return dow == time.Saturday || dow == time.Sunday
}

func pgDate(t time.Time) pgtype.Date {
	return pgtype.Date{Time: t, Valid: true}
}

type runIntentRequest struct {
	RunDate   string `json:"run_date"`
	WindowKey string `json:"window_key"`
}

// parseIntentBucket validates a (run_date, window_key) pair: a real
// availability window, a date within [today, today+maxIntentLeadDays] in UTC
// calendar days, and a weekday/weekend that matches the window's.
func parseIntentBucket(req runIntentRequest, now time.Time) (time.Time, error) {
	span, ok := windowSpanByKey(req.WindowKey)
	if !ok {
		return time.Time{}, errors.New("window_key must be a valid availability window")
	}
	date, err := time.ParseInLocation("2006-01-02", req.RunDate, time.UTC)
	if err != nil {
		return time.Time{}, errors.New("run_date must be YYYY-MM-DD")
	}
	today := now.UTC().Truncate(24 * time.Hour)
	if date.Before(today) {
		return time.Time{}, errors.New("run_date must not be in the past")
	}
	if date.After(today.AddDate(0, 0, maxIntentLeadDays)) {
		return time.Time{}, fmt.Errorf("run_date must be within the next %d days", maxIntentLeadDays)
	}
	if isWeekendDate(date) != span.weekend {
		return time.Time{}, errors.New("window_key does not match run_date's day of week")
	}
	return date, nil
}

// bucketForSessionTime maps a planned run's start time onto its intent
// bucket, using the same UTC convention as parseIntentBucket. Approximate,
// not per-user-timezone: buckets are symbolic labels, not exact times.
func bucketForSessionTime(t time.Time) (date time.Time, windowKey string, ok bool) {
	u := t.UTC()
	d := u.Truncate(24 * time.Hour)
	weekend := isWeekendDate(u)
	hour := u.Hour()
	for _, span := range windowSpans {
		if span.weekend == weekend && hour >= span.start && hour < span.end {
			return d, span.key, true
		}
	}
	return time.Time{}, "", false
}

// bucketLabel renders a bucket for push copy, e.g. "Today evening" /
// "Thursday morning".
func bucketLabel(date time.Time, windowLabel string) string {
	today := time.Now().UTC().Truncate(24 * time.Hour)
	day := date.Weekday().String()
	switch {
	case date.Equal(today):
		day = "Today"
	case date.Equal(today.AddDate(0, 0, 1)):
		day = "Tomorrow"
	}
	return day + " " + windowLabel
}

func (s *Server) handleSetRunIntent(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req runIntentRequest
	if !readJSON(w, r, &req) {
		return
	}
	date, err := parseIntentBucket(req, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	court, err := s.store.Queries.GetCourt(r.Context(), courtID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusNotFound, "court not found")
			return
		}
		s.internalError(w, "get court", err)
		return
	}
	if court.Status == "rejected" {
		writeError(w, http.StatusUnprocessableEntity, "cannot look for a run at a rejected court")
		return
	}
	if _, err := s.store.Queries.UpsertRunIntent(r.Context(), gen.UpsertRunIntentParams{
		CourtID: courtID, UserID: userID(r), RunDate: pgDate(date), WindowKey: req.WindowKey,
	}); err != nil {
		s.internalError(w, "upsert run intent", err)
		return
	}
	count, err := s.store.Queries.CountRunIntentBucket(r.Context(), gen.CountRunIntentBucketParams{
		CourtID: courtID, RunDate: pgDate(date), WindowKey: req.WindowKey,
	})
	if err != nil {
		s.internalError(w, "count run intent bucket", err)
		return
	}
	if count >= intentThreshold {
		s.runBackground("notify run intent threshold", func() {
			s.notifyRunIntentThreshold(courtID, court.Name, date, req.WindowKey, count)
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"joined": true, "count": count})
}

func (s *Server) handleWithdrawRunIntent(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	var req runIntentRequest
	if !readJSON(w, r, &req) {
		return
	}
	date, err := parseIntentBucket(req, time.Now())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := s.store.Queries.WithdrawRunIntent(r.Context(), gen.WithdrawRunIntentParams{
		CourtID: courtID, UserID: userID(r), RunDate: pgDate(date), WindowKey: req.WindowKey,
	}); err != nil {
		s.internalError(w, "withdraw run intent", err)
		return
	}
	count, err := s.store.Queries.CountRunIntentBucket(r.Context(), gen.CountRunIntentBucketParams{
		CourtID: courtID, RunDate: pgDate(date), WindowKey: req.WindowKey,
	})
	if err != nil {
		s.internalError(w, "count run intent bucket", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"joined": false, "count": count})
}

type runIntentSeeker struct {
	RunDate     string  `json:"run_date"`
	WindowKey   string  `json:"window_key"`
	UserID      string  `json:"user_id"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	SkillLevel  *string `json:"skill_level"`
}

// handleListRunIntents is public, matching the public RSVP/attendee lists.
func (s *Server) handleListRunIntents(w http.ResponseWriter, r *http.Request) {
	courtID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid court id")
		return
	}
	rows, err := s.store.Queries.ListRunIntentsForCourt(r.Context(), courtID)
	if err != nil {
		s.internalError(w, "list run intents", err)
		return
	}
	now := time.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	out := make([]runIntentSeeker, 0, len(rows))
	for _, row := range rows {
		date := row.RunDate.Time
		// Same-day buckets past their window are expired; filtered at read
		// time, as check-ins are.
		if date.Equal(today) {
			if span, ok := windowSpanByKey(row.WindowKey); ok && now.Hour() >= span.end {
				continue
			}
		}
		out = append(out, runIntentSeeker{
			RunDate: date.Format("2006-01-02"), WindowKey: row.WindowKey,
			UserID: row.UserID.String(), DisplayName: row.DisplayName,
			AvatarURL: row.AvatarUrl, SkillLevel: row.SkillLevel,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"seekers": out})
}

// notifyRunIntentThreshold pushes everyone in a bucket once it hits
// intentThreshold. Fire-and-forget, gated to send exactly once per bucket
// however membership churns afterward.
func (s *Server) notifyRunIntentThreshold(courtID uuid.UUID, courtName string, date time.Time, windowKey string, count int32) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	won, err := s.store.Queries.MarkRunIntentThresholdAlerted(ctx, gen.MarkRunIntentThresholdAlertedParams{
		CourtID: courtID, RunDate: pgDate(date), WindowKey: windowKey,
	})
	if err != nil {
		s.log.Error("mark run intent threshold alerted", "court", courtID, "err", err)
		return
	}
	if won == 0 {
		return
	}
	span, ok := windowSpanByKey(windowKey)
	if !ok {
		return
	}
	tokens, err := s.store.Queries.ListRunIntentBucketTokens(ctx, gen.ListRunIntentBucketTokensParams{
		CourtID: courtID, RunDate: pgDate(date), WindowKey: windowKey, ExcludeUserID: uuid.Nil,
	})
	if err != nil || len(tokens) == 0 {
		if err != nil {
			s.log.Error("list run intent bucket tokens", "court", courtID, "err", err)
		}
		return
	}
	if err := push.Send(ctx, tokens,
		fmt.Sprintf("%d players want to run at %s", count, courtName),
		bucketLabel(date, span.label)+" — plan it?",
		map[string]string{
			"courtId": courtID.String(), "runDate": date.Format("2006-01-02"),
			"windowKey": windowKey, "action": "plan_run",
		},
	); err != nil {
		s.log.Error("run intent threshold push", "court", courtID, "err", err)
	}
}

// notifyRunIntentConverted pushes a bucket's seekers (except the planner)
// when a session lands inside their window. Gated like the threshold push.
func (s *Server) notifyRunIntentConverted(courtID uuid.UUID, courtName string, date time.Time, windowKey string, actor, sessionID uuid.UUID) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	won, err := s.store.Queries.MarkRunIntentConverted(ctx, gen.MarkRunIntentConvertedParams{
		CourtID: courtID, RunDate: pgDate(date), WindowKey: windowKey,
	})
	if err != nil {
		s.log.Error("mark run intent converted", "court", courtID, "err", err)
		return
	}
	if won == 0 {
		return
	}
	span, ok := windowSpanByKey(windowKey)
	if !ok {
		return
	}
	tokens, err := s.store.Queries.ListRunIntentBucketTokens(ctx, gen.ListRunIntentBucketTokensParams{
		CourtID: courtID, RunDate: pgDate(date), WindowKey: windowKey, ExcludeUserID: actor,
	})
	if err != nil || len(tokens) == 0 {
		if err != nil {
			s.log.Error("list run intent bucket tokens", "court", courtID, "err", err)
		}
		return
	}
	if err := push.Send(ctx, tokens,
		fmt.Sprintf("A run was just planned at %s", courtName),
		bucketLabel(date, span.label)+" is on — RSVP",
		map[string]string{
			"courtId": courtID.String(), "sessionId": sessionID.String(), "action": "view_run",
		},
	); err != nil {
		s.log.Error("run intent converted push", "court", courtID, "err", err)
	}
}
