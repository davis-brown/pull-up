package api_test

import (
	"net/http"
	"testing"
)

func TestFeedRequiresAuth(t *testing.T) {
	ts, _ := newTestServer(t)
	resp := doJSON(t, ts, http.MethodGet, "/feed", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("no-bearer /feed: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestFeedEmptyForNewUser(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "feed@test.local", "Feed User")

	resp := doJSON(t, ts, http.MethodGet, "/feed", u.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get feed: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	body := decodeJSON[struct {
		FriendsHere  []map[string]any `json:"friends_here"`
		UpcomingRuns []map[string]any `json:"upcoming_runs"`
	}](t, resp)
	if len(body.FriendsHere) != 0 || len(body.UpcomingRuns) != 0 {
		t.Errorf("new user feed not empty: %+v", body)
	}
}
