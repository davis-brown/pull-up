package api_test

import (
	"net/http"
	"testing"
)

type leaderboardBody struct {
	Metric string `json:"metric"`
	Season struct {
		Key       string `json:"key"`
		Label     string `json:"label"`
		StartedAt string `json:"started_at"`
		EndsAt    string `json:"ends_at"`
	} `json:"season"`
	Entries []struct {
		Rank        int    `json:"rank"`
		UserID      string `json:"user_id"`
		DisplayName string `json:"display_name"`
		Score       int    `json:"score"`
		Metric      string `json:"metric"`
	} `json:"entries"`
	ViewerRank *int `json:"viewer_rank"`
}

func (b leaderboardBody) names() []string {
	out := make([]string, 0, len(b.Entries))
	for _, e := range b.Entries {
		out = append(out, e.DisplayName)
	}
	return out
}

// The court board uses the same visibility predicate as the court's activity
// list: yourself, public accounts, and accounts you follow.
func TestCourtLeaderboardHidesPrivateStrangersAndBlocks(t *testing.T) {
	ts, _ := newTestServer(t)
	viewer := registerUser(t, ts, "lb-viewer@test.local", "Viewer")
	public := registerUser(t, ts, "lb-public@test.local", "PublicPlayer")
	privateFollowed := registerUser(t, ts, "lb-priv-follow@test.local", "PrivateFriend")
	privateStranger := registerUser(t, ts, "lb-priv-stranger@test.local", "PrivateStranger")
	blocked := registerUser(t, ts, "lb-blocked@test.local", "BlockedPlayer")

	court := createTestCourt(t, ts, viewer.AccessToken, "Leaderboard Court", ruckerLat, ruckerLng)

	checkIn := func(token string) {
		t.Helper()
		resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", token, map[string]any{
			"lat": ruckerLat, "lng": ruckerLng,
		})
		if resp.StatusCode != http.StatusCreated {
			defer resp.Body.Close()
			t.Fatalf("check in: status %d: %s", resp.StatusCode, readBody(t, resp))
		}
		resp.Body.Close()
	}
	for _, u := range []struct{ token string }{
		{viewer.AccessToken}, {public.AccessToken}, {privateFollowed.AccessToken},
		{privateStranger.AccessToken}, {blocked.AccessToken},
	} {
		checkIn(u.token)
	}

	// PrivateFriend accepts the viewer before going private, so the follow
	// is an accepted one; PrivateStranger never does.
	doJSON(t, ts, http.MethodPut, "/users/"+privateFollowed.User.ID+"/follow", viewer.AccessToken, nil).Body.Close()
	doJSON(t, ts, http.MethodPatch, "/me", privateFollowed.AccessToken, map[string]any{"is_private": true}).Body.Close()
	doJSON(t, ts, http.MethodPatch, "/me", privateStranger.AccessToken, map[string]any{"is_private": true}).Body.Close()
	// A block in either direction removes the player from the viewer's board.
	doJSON(t, ts, http.MethodPut, "/users/"+viewer.User.ID+"/block", blocked.AccessToken, nil).Body.Close()

	resp := doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/leaderboard", viewer.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("court leaderboard: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	board := decodeJSON[leaderboardBody](t, resp)

	shown := map[string]bool{}
	for _, e := range board.Entries {
		shown[e.DisplayName] = true
		if e.Score < 1 {
			t.Errorf("%s ranked with score %d, want at least 1 check-in", e.DisplayName, e.Score)
		}
	}
	for _, want := range []string{"Viewer", "PublicPlayer", "PrivateFriend"} {
		if !shown[want] {
			t.Errorf("%s missing from board; got %v", want, board.names())
		}
	}
	for _, hidden := range []string{"PrivateStranger", "BlockedPlayer"} {
		if shown[hidden] {
			t.Errorf("%s leaked onto the board; got %v", hidden, board.names())
		}
	}

	if board.Metric != "check_ins" {
		t.Errorf("metric = %q, want check_ins", board.Metric)
	}
	if board.Season.Key == "" || board.Season.Label == "" || board.Season.StartedAt == "" {
		t.Errorf("season = %+v, want a populated window", board.Season)
	}
	if board.ViewerRank == nil {
		t.Error("viewer_rank is null, but the viewer checked in here")
	}
	for i, e := range board.Entries {
		if e.Rank != i+1 {
			t.Errorf("entries[%d].rank = %d, want %d", i, e.Rank, i+1)
		}
	}
}

// The circle board needs no privacy predicate beyond blocks, since `follows`
// only ever holds accepted follows.
func TestCircleLeaderboardCoversOnlyTheViewerAndTheirFollows(t *testing.T) {
	ts, _ := newTestServer(t)
	viewer := registerUser(t, ts, "circle-viewer@test.local", "CircleViewer")
	followed := registerUser(t, ts, "circle-followed@test.local", "Followed")
	stranger := registerUser(t, ts, "circle-stranger@test.local", "Stranger")

	court := createTestCourt(t, ts, viewer.AccessToken, "Circle Court", ruckerLat, ruckerLng)
	for _, token := range []string{viewer.AccessToken, followed.AccessToken, stranger.AccessToken} {
		resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", token, map[string]any{
			"lat": ruckerLat, "lng": ruckerLng,
		})
		resp.Body.Close()
	}
	doJSON(t, ts, http.MethodPut, "/users/"+followed.User.ID+"/follow", viewer.AccessToken, nil).Body.Close()

	resp := doJSON(t, ts, http.MethodGet, "/me/circle/leaderboard", viewer.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("circle leaderboard: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	board := decodeJSON[leaderboardBody](t, resp)

	shown := map[string]bool{}
	for _, e := range board.Entries {
		shown[e.DisplayName] = true
	}
	if !shown["CircleViewer"] || !shown["Followed"] {
		t.Errorf("circle board = %v, want the viewer and Followed", board.names())
	}
	if shown["Stranger"] {
		t.Errorf("Stranger leaked into the circle board; got %v", board.names())
	}
	if board.Metric != "xp" {
		t.Errorf("metric = %q, want xp", board.Metric)
	}
	if board.ViewerRank == nil {
		t.Error("viewer_rank is null, but the viewer is always in their own circle")
	}
}

// A followed player who earned nothing this window still appears, at zero.
func TestCircleLeaderboardKeepsIdleFollowsAtZero(t *testing.T) {
	ts, _ := newTestServer(t)
	viewer := registerUser(t, ts, "idle-viewer@test.local", "IdleViewer")
	idle := registerUser(t, ts, "idle-follow@test.local", "IdleFollow")
	doJSON(t, ts, http.MethodPut, "/users/"+idle.User.ID+"/follow", viewer.AccessToken, nil).Body.Close()

	resp := doJSON(t, ts, http.MethodGet, "/me/circle/leaderboard", viewer.AccessToken, nil)
	board := decodeJSON[leaderboardBody](t, resp)

	var found bool
	for _, e := range board.Entries {
		if e.DisplayName == "IdleFollow" {
			found = true
			if e.Score != 0 {
				t.Errorf("IdleFollow score = %d, want 0", e.Score)
			}
		}
	}
	if !found {
		t.Errorf("IdleFollow dropped from the board; got %v", board.names())
	}
}
