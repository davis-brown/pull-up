package api_test

import (
	"fmt"
	"net/http"
	"testing"
)

// Guest browsing contract: every read surface the app shows signed-out users
// must work with no bearer token, and every mutation must 401.
func TestGuestReadAccess(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "guest-owner@test.local", "Owner")

	resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, map[string]any{
		"name": "Guest Test Court", "lat": 40.741, "lng": -73.99, "indoor": false,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create court: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	court := decodeJSON[struct {
		ID string `json:"id"`
	}](t, resp)

	reads := []string{
		"/courts?bbox=-74.1,40.6,-73.8,40.9",
		"/courts/" + court.ID,
		"/courts/" + court.ID + "/activity",
		"/courts/" + court.ID + "/photos",
		"/courts/" + court.ID + "/sessions",
		"/courts/" + court.ID + "/messages",
	}
	for _, path := range reads {
		resp := doJSON(t, ts, http.MethodGet, path, "", nil)
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s unauthenticated: status %d, want 200: %s",
				path, resp.StatusCode, readBody(t, resp))
		}
		resp.Body.Close()
	}
}

func TestGuestWritesRejected(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "guest-owner2@test.local", "Owner2")

	resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, map[string]any{
		"name": "Guest Write Court", "lat": 40.75, "lng": -73.98, "indoor": false,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create court: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	court := decodeJSON[struct {
		ID string `json:"id"`
	}](t, resp)

	writes := []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/courts", map[string]any{"name": "X", "lat": 1.0, "lng": 1.0, "indoor": false}},
		{http.MethodPost, fmt.Sprintf("/courts/%s/check-ins", court.ID), map[string]any{"lat": 40.75, "lng": -73.98}},
		{http.MethodPut, fmt.Sprintf("/courts/%s/favorite", court.ID), nil},
		{http.MethodPost, fmt.Sprintf("/courts/%s/messages", court.ID), map[string]any{"body": "hi"}},
		{http.MethodPost, fmt.Sprintf("/courts/%s/sessions", court.ID), map[string]any{"starts_at": "2030-01-01T18:00:00Z"}},
		{http.MethodGet, "/me", nil},
	}
	for _, w := range writes {
		resp := doJSON(t, ts, w.method, w.path, "", w.body)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s unauthenticated: status %d, want 401", w.method, w.path, resp.StatusCode)
		}
		resp.Body.Close()
	}
}
