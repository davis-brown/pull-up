package api_test

import (
	"net/http"
	"testing"
)

func TestGetProfilePublic(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "profile@test.local", "Profile Player")

	// Public read, no bearer.
	resp := doJSON(t, ts, http.MethodGet, "/users/"+u.User.ID, "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get profile: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	body := decodeJSON[struct {
		ID            string `json:"id"`
		DisplayName   string `json:"display_name"`
		CheckInCount  int    `json:"check_in_count"`
		FollowerCount int    `json:"follower_count"`
		StreakDays    int    `json:"streak_days"`
		IsFollowing   bool   `json:"is_following"`
	}](t, resp)
	if body.DisplayName != "Profile Player" || body.CheckInCount != 0 || body.FollowerCount != 0 {
		t.Errorf("unexpected profile: %+v", body)
	}

	// Unknown user → 404.
	resp = doJSON(t, ts, http.MethodGet, "/users/00000000-0000-0000-0000-000000000000", "", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown user: status %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
}
