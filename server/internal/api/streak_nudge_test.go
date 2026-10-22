package api_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// The evening gate runs in SQL so the batch limit is spent only on people
// who can be nudged right now, and one unknown zone can't fail the batch.
func TestStreakNudgeCandidatesLocalWindow(t *testing.T) {
	ts, st := newTestServer(t)
	ctx := context.Background()
	ny := registerUser(t, ts, "nudge-ny@test.local", "NudgeNY")
	bogus := registerUser(t, ts, "nudge-bogus@test.local", "NudgeBogus")
	court := createTestCourt(t, ts, ny.AccessToken, "Nudge Court", ruckerLat, ruckerLng)

	for _, u := range []struct{ id, tz string }{
		{ny.User.ID, "America/New_York"},
		{bogus.User.ID, "Not/AZone"},
	} {
		if _, err := st.Pool.Exec(ctx, `UPDATE users SET timezone = $2 WHERE id = $1`, u.id, u.tz); err != nil {
			t.Fatalf("set timezone: %v", err)
		}
		if _, err := st.Pool.Exec(ctx, `INSERT INTO push_tokens (token, user_id) VALUES ($1, $2)`,
			"ExponentPushToken["+u.id+"]", u.id); err != nil {
			t.Fatalf("add push token: %v", err)
		}
		// A check-in last week and none this week: a streak at risk.
		if _, err := st.Pool.Exec(ctx, `
			INSERT INTO check_ins (court_id, user_id, source, expires_at, created_at)
			VALUES ($1, $2, 'manual', '2026-10-15T20:00:00Z', '2026-10-15T18:00:00Z')`,
			court.ID, u.id); err != nil {
			t.Fatalf("seed check-in: %v", err)
		}
	}

	nyTime := func(hour int) time.Time {
		loc, err := time.LoadLocation("America/New_York")
		if err != nil {
			t.Fatalf("load zone: %v", err)
		}
		return time.Date(2026, 10, 22, hour, 30, 0, 0, loc) // a Thursday
	}
	candidates := func(now time.Time) []uuid.UUID {
		rows, err := st.Queries.ListStreakNudgeCandidates(ctx, gen.ListStreakNudgeCandidatesParams{
			Now: now, MaxCandidates: 200,
		})
		if err != nil {
			t.Fatalf("list candidates: %v", err)
		}
		var ids []uuid.UUID
		for _, r := range rows {
			ids = append(ids, r.UserID)
		}
		return ids
	}

	if got := candidates(nyTime(18)); !slices.Equal(got, []uuid.UUID{uuid.MustParse(ny.User.ID)}) {
		t.Errorf("Thursday 18:30 New York: candidates = %v, want only %s", got, ny.User.ID)
	}
	if got := candidates(nyTime(12)); len(got) != 0 {
		t.Errorf("Thursday 12:30 New York: candidates = %v, want none", got)
	}
}
