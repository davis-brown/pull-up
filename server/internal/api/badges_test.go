package api_test

import (
	"net/http"
	"testing"
)

type meStatsBadges struct {
	Badges []struct {
		ID       string  `json:"id"`
		Earned   bool    `json:"earned"`
		EarnedAt *string `json:"earned_at"`
	} `json:"badges"`
	NewBadges []string `json:"new_badges"`
	Courts    int      `json:"courts"`
}

func (m meStatsBadges) badge(t *testing.T, id string) (bool, *string) {
	t.Helper()
	for _, b := range m.Badges {
		if b.ID == id {
			return b.Earned, b.EarnedAt
		}
	}
	t.Fatalf("badge %q missing from /me/stats", id)
	return false, nil
}

func contains(hay []string, needle string) bool {
	for _, s := range hay {
		if s == needle {
			return true
		}
	}
	return false
}

// The baseline is the whole reason phase 21b needs a synced-at marker.
// Every existing player already satisfies several badge rules, so recording
// earn dates naively would celebrate badges they won a month ago the first
// time they opened the app after deploy. The first stats read must record
// what is already earned as ALREADY SEEN, and only later earnings count as
// new.
func TestBadgeBaselineThenNewBadgeIsCelebrated(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "badge-baseline@test.local", "BadgeBaseline")

	checkInAt := func(name string, lat, lng float64) {
		t.Helper()
		court := createTestCourt(t, ts, u.AccessToken, name, lat, lng)
		resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
			"lat": lat, "lng": lng,
		})
		if resp.StatusCode != http.StatusCreated {
			defer resp.Body.Close()
			t.Fatalf("check in at %s: status %d: %s", name, resp.StatusCode, readBody(t, resp))
		}
		resp.Body.Close()
	}
	fetchStats := func() meStatsBadges {
		t.Helper()
		resp := doJSON(t, ts, http.MethodGet, "/me/stats?tz_offset_minutes=0", u.AccessToken, nil)
		if resp.StatusCode != http.StatusOK {
			defer resp.Body.Close()
			t.Fatalf("me stats: status %d: %s", resp.StatusCode, readBody(t, resp))
		}
		return decodeJSON[meStatsBadges](t, resp)
	}

	// One check-in earns first_run. The player has never fetched stats, so
	// this fetch is their baseline.
	checkInAt("Badge Court One", ruckerLat, ruckerLng)
	baseline := fetchStats()
	if earned, _ := baseline.badge(t, "first_run"); !earned {
		t.Fatalf("first_run not earned after a check-in; badges = %+v", baseline.Badges)
	}
	if len(baseline.NewBadges) != 0 {
		t.Errorf("baseline new_badges = %v, want empty: already-earned badges are not news", baseline.NewBadges)
	}
	if _, earnedAt := baseline.badge(t, "first_run"); earnedAt == nil {
		t.Error("first_run earned_at is null after the baseline recorded it")
	}
	// An unearned badge carries no date.
	if _, earnedAt := baseline.badge(t, "explorer"); earnedAt != nil {
		t.Errorf("explorer earned_at = %v, want null while unearned", *earnedAt)
	}

	// Four more distinct courts crosses explorer's threshold of 5.
	for i, name := range []string{"Two", "Three", "Four", "Five"} {
		checkInAt("Badge Court "+name, ruckerLat+0.05*float64(i+1), ruckerLng)
	}

	after := fetchStats()
	if after.Courts != 5 {
		t.Fatalf("courts = %d, want 5", after.Courts)
	}
	if earned, _ := after.badge(t, "explorer"); !earned {
		t.Fatalf("explorer not earned at 5 courts; badges = %+v", after.Badges)
	}
	if !contains(after.NewBadges, "explorer") {
		t.Errorf("new_badges = %v, want to include explorer", after.NewBadges)
	}
	// The badge that existed at baseline stays quiet — this is the assertion
	// that the baseline actually suppressed it rather than merely delaying it.
	if contains(after.NewBadges, "first_run") {
		t.Errorf("new_badges = %v, want first_run suppressed by the baseline", after.NewBadges)
	}

	// Acking spends the moment: the badge stays earned, but stops being new.
	resp := doJSON(t, ts, http.MethodPost, "/me/badges/ack", u.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		defer resp.Body.Close()
		t.Fatalf("ack badges: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	acked := fetchStats()
	if len(acked.NewBadges) != 0 {
		t.Errorf("new_badges = %v after ack, want empty", acked.NewBadges)
	}
	if earned, earnedAt := acked.badge(t, "explorer"); !earned || earnedAt == nil {
		t.Error("explorer lost its earned state or date after ack")
	}
}
