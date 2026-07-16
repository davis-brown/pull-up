package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func TestSessionAttendeeNamesRespectPrivacyAndBlocks(t *testing.T) {
	ts, st := newTestServer(t)
	planner := registerUser(t, ts, "private-attendee@test.local", "Private Attendee")
	viewer := registerUser(t, ts, "attendee-viewer@test.local", "Attendee Viewer")
	court := createTestCourt(t, ts, planner.AccessToken, "Attendee Court", ruckerLat, ruckerLng)
	doJSON(t, ts, http.MethodPatch, "/me", planner.AccessToken, map[string]any{"is_private": true}).Body.Close()

	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/sessions", planner.AccessToken, map[string]any{
		"starts_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create session: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	session := decodeJSON[struct {
		ID string `json:"id"`
	}](t, resp)

	readAttendees := func(token string) (int, int) {
		resp := doJSON(t, ts, http.MethodGet, "/sessions/"+session.ID+"/attendees", token, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("list attendees: status %d", resp.StatusCode)
		}
		body := decodeJSON[struct {
			GoingCount int              `json:"going_count"`
			Attendees  []map[string]any `json:"attendees"`
		}](t, resp)
		return body.GoingCount, len(body.Attendees)
	}
	if count, names := readAttendees(""); count != 1 || names != 0 {
		t.Fatalf("anonymous attendees count=%d names=%d, want 1/0", count, names)
	}
	if count, names := readAttendees(viewer.AccessToken); count != 1 || names != 0 {
		t.Fatalf("non-follower attendees count=%d names=%d, want 1/0", count, names)
	}
	if err := st.Queries.Follow(context.Background(), gen.FollowParams{
		FollowerID: mustUUID(t, viewer.User.ID), FolloweeID: mustUUID(t, planner.User.ID),
	}); err != nil {
		t.Fatalf("follow private attendee: %v", err)
	}
	if count, names := readAttendees(viewer.AccessToken); count != 1 || names != 1 {
		t.Fatalf("follower attendees count=%d names=%d, want 1/1", count, names)
	}

	doJSON(t, ts, http.MethodPatch, "/me", planner.AccessToken, map[string]any{"is_private": false}).Body.Close()
	resp = doJSON(t, ts, http.MethodPut, "/users/"+viewer.User.ID+"/block", planner.AccessToken, nil)
	resp.Body.Close()
	if count, names := readAttendees(viewer.AccessToken); count != 1 || names != 0 {
		t.Fatalf("blocked attendees count=%d names=%d, want 1/0", count, names)
	}
}
