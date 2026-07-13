package api_test

import (
	"net/http"
	"testing"
)

// TestMeStatsShapeAndBadges is a full-stack check that the wiring (route,
// queries, response assembly) works end to end: one check-in should
// produce games=1, courts=1, a home_courts entry with the live party-size
// headcount, and only the first_run badge earned (every other badge's
// threshold is well above 1). DB-backed; skips locally without
// TEST_DATABASE_URL, same as every other test in this file's family.
func TestMeStatsShapeAndBadges(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "stats@test.local", "StatsUser")
	court := createTestCourt(t, ts, u.AccessToken, "Stats Court", ruckerLat, ruckerLng)

	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat, "lng": ruckerLng, "party_size": 2,
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("check-in: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/me/stats", u.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("me/stats: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	stats := decodeJSON[struct {
		Games      int `json:"games"`
		Courts     int `json:"courts"`
		WeekStreak int `json:"week_streak"`
		Badges     []struct {
			ID     string `json:"id"`
			Earned bool   `json:"earned"`
		} `json:"badges"`
		HomeCourts []struct {
			CourtID   string `json:"court_id"`
			Name      string `json:"name"`
			CheckIns  int    `json:"check_ins"`
			LiveCount int    `json:"live_count"`
		} `json:"home_courts"`
	}](t, resp)

	if stats.Games != 1 {
		t.Errorf("games = %d, want 1", stats.Games)
	}
	if stats.Courts != 1 {
		t.Errorf("courts = %d, want 1", stats.Courts)
	}
	if stats.WeekStreak != 1 {
		t.Errorf("week_streak = %d, want 1 (checked in this week)", stats.WeekStreak)
	}

	wantIDs := []string{"first_run", "explorer", "early_bird", "regular", "streak_4", "host"}
	if len(stats.Badges) != len(wantIDs) {
		t.Fatalf("len(badges) = %d, want %d: %+v", len(stats.Badges), len(wantIDs), stats.Badges)
	}
	for i, b := range stats.Badges {
		if b.ID != wantIDs[i] {
			t.Errorf("badges[%d].ID = %q, want %q", i, b.ID, wantIDs[i])
		}
		wantEarned := b.ID == "first_run"
		if b.Earned != wantEarned {
			t.Errorf("badge %q earned = %v, want %v", b.ID, b.Earned, wantEarned)
		}
	}

	if len(stats.HomeCourts) != 1 {
		t.Fatalf("home_courts = %+v, want 1 entry", stats.HomeCourts)
	}
	hc := stats.HomeCourts[0]
	if hc.CourtID != court.ID || hc.Name != "Stats Court" {
		t.Errorf("home_courts[0] = %+v, want court %s (Stats Court)", hc, court.ID)
	}
	if hc.CheckIns != 1 {
		t.Errorf("home_courts[0].check_ins = %d, want 1", hc.CheckIns)
	}
	if hc.LiveCount != 2 {
		t.Errorf("home_courts[0].live_count = %d, want 2 (party_size sum, not row count)", hc.LiveCount)
	}
}

// TestMeStatsRequiresAuth guards the route registration itself: without a
// bearer token, /me/stats should 401 like every other /me/* route, not
// panic or 500 from a nil userID.
func TestMeStatsRequiresAuth(t *testing.T) {
	ts, _ := newTestServer(t)
	resp := doJSON(t, ts, http.MethodGet, "/me/stats", "", nil)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401: %s", resp.StatusCode, readBody(t, resp))
	}
}
