package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"
)

type gameResp struct {
	Game struct {
		ID          string `json:"id"`
		WinningTeam int    `json:"winning_team"`
		Status      string `json:"status"`
	} `json:"game"`
}

func TestGameConfirmationRules(t *testing.T) {
	ts, st := newTestServer(t)
	winner := registerUser(t, ts, "game-winner@test.local", "Winner")
	loser := registerUser(t, ts, "game-loser@test.local", "Loser")
	bystander := registerUser(t, ts, "game-bystander@test.local", "Bystander")
	court := createTestCourt(t, ts, winner.AccessToken, "Game Court", ruckerLat, ruckerLng)

	record := func(token string, body map[string]any) *http.Response {
		return doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/games", token, body)
	}

	// Validation: the recorder must have played, teams can't overlap, and
	// a partial or backwards score is rejected.
	bad := []map[string]any{
		{"team_a": []string{loser.User.ID}, "team_b": []string{bystander.User.ID}, "winning_team": 0},
		{"team_a": []string{winner.User.ID}, "team_b": []string{winner.User.ID}, "winning_team": 0},
		{"team_a": []string{winner.User.ID}, "team_b": []string{loser.User.ID}, "winning_team": 2},
		{"team_a": []string{winner.User.ID}, "team_b": []string{loser.User.ID}, "winning_team": 0, "score_win": 11},
		{"team_a": []string{winner.User.ID}, "team_b": []string{loser.User.ID}, "winning_team": 0, "score_win": 5, "score_lose": 11},
		{"team_a": []string{}, "team_b": []string{loser.User.ID}, "winning_team": 1},
	}
	for _, body := range bad {
		resp := record(winner.AccessToken, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("body %+v: status %d, want 400: %s", body, resp.StatusCode, readBody(t, resp))
		} else {
			resp.Body.Close()
		}
	}

	// A valid game: winner records, team 0 (themselves) took it.
	resp := record(winner.AccessToken, map[string]any{
		"team_a": []string{winner.User.ID}, "team_b": []string{loser.User.ID},
		"winning_team": 0, "score_win": 11, "score_lose": 7,
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("record valid game: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	game := decodeJSON[gameResp](t, resp)
	if game.Game.Status != "unconfirmed" {
		t.Fatalf("new game status = %q, want unconfirmed", game.Game.Status)
	}
	gameID := game.Game.ID

	// Unconfirmed games are absent from the public court listing.
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/games", "", nil)
	listed := decodeJSON[map[string][]map[string]any](t, resp)
	if len(listed["games"]) != 0 {
		t.Errorf("unconfirmed game is publicly visible: %+v", listed["games"])
	}

	// Someone who wasn't in the game can't confirm it.
	resp = doJSON(t, ts, http.MethodPost, "/games/"+gameID+"/confirm", bystander.AccessToken, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("bystander confirm: status %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// The winning side can't confirm its own result — including the
	// recorder, whose agreement is implied and proves nothing.
	resp = doJSON(t, ts, http.MethodPost, "/games/"+gameID+"/confirm", winner.AccessToken, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("winner self-confirm: status %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// It shows up in the loser's pending queue.
	resp = doJSON(t, ts, http.MethodGet, "/me/games/pending", loser.AccessToken, nil)
	pending := decodeJSON[map[string][]map[string]any](t, resp)
	if len(pending["games"]) != 1 {
		t.Fatalf("loser pending games = %d, want 1", len(pending["games"]))
	}

	// The losing side confirms: the game becomes a fact.
	resp = doJSON(t, ts, http.MethodPost, "/games/"+gameID+"/confirm", loser.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("loser confirm: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	var status string
	if err := st.Pool.QueryRow(context.Background(),
		"SELECT status FROM games WHERE id = $1", gameID).Scan(&status); err != nil {
		t.Fatalf("read game status: %v", err)
	}
	if status != "confirmed" {
		t.Fatalf("status after opposing confirm = %q, want confirmed", status)
	}

	// Now it's public, with both players and the score.
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/games", "", nil)
	listed = decodeJSON[map[string][]map[string]any](t, resp)
	if len(listed["games"]) != 1 {
		t.Fatalf("confirmed games listed = %d, want 1", len(listed["games"]))
	}
	if players, ok := listed["games"][0]["players"].([]any); !ok || len(players) != 2 {
		t.Errorf("confirmed game players = %v, want 2", listed["games"][0]["players"])
	}
	if listed["games"][0]["score_win"] != float64(11) {
		t.Errorf("score_win = %v, want 11", listed["games"][0]["score_win"])
	}

	// It leaves the pending queue, and re-confirming is a harmless no-op.
	resp = doJSON(t, ts, http.MethodGet, "/me/games/pending", loser.AccessToken, nil)
	pending = decodeJSON[map[string][]map[string]any](t, resp)
	if len(pending["games"]) != 0 {
		t.Errorf("pending after confirm = %d, want 0", len(pending["games"]))
	}
	resp = doJSON(t, ts, http.MethodPost, "/games/"+gameID+"/confirm", loser.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("re-confirm: status %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestGameXPOnlyOnConfirmationAndRecordInStats(t *testing.T) {
	ts, st := newTestServer(t)
	winner := registerUser(t, ts, "gx-winner@test.local", "GXWinner")
	loser := registerUser(t, ts, "gx-loser@test.local", "GXLoser")
	court := createTestCourt(t, ts, winner.AccessToken, "GX Court", ruckerLat, ruckerLng)

	xpOf := func(userID string) int {
		var xp int
		if err := st.Pool.QueryRow(context.Background(),
			"SELECT xp FROM users WHERE id = $1", userID).Scan(&xp); err != nil {
			t.Fatalf("read xp: %v", err)
		}
		return xp
	}
	gameXPEvents := func() int {
		var n int
		if err := st.Pool.QueryRow(context.Background(),
			"SELECT count(*) FROM xp_events WHERE kind = 'game_played'").Scan(&n); err != nil {
			t.Fatalf("count game xp events: %v", err)
		}
		return n
	}

	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/games", winner.AccessToken, map[string]any{
		"team_a": []string{winner.User.ID}, "team_b": []string{loser.User.ID}, "winning_team": 0,
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("record game: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	gameID := decodeJSON[gameResp](t, resp).Game.ID

	// An unconfirmed game pays nobody: that's what stops two colluding
	// accounts from minting XP by logging games at each other.
	time.Sleep(300 * time.Millisecond)
	if got := gameXPEvents(); got != 0 {
		t.Fatalf("unconfirmed game awarded xp: %d events, want 0", got)
	}

	resp = doJSON(t, ts, http.MethodPost, "/games/"+gameID+"/confirm", loser.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("confirm: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	deadline := time.Now().Add(3 * time.Second)
	for gameXPEvents() < 2 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if got := gameXPEvents(); got != 2 {
		t.Fatalf("game xp events = %d, want 2 (one per participant)", got)
	}
	if got := xpOf(winner.User.ID); got < 10 {
		t.Errorf("winner xp = %d, want at least the 10 from the game", got)
	}

	// Re-confirming can't pay a second time.
	resp = doJSON(t, ts, http.MethodPost, "/games/"+gameID+"/confirm", loser.AccessToken, nil)
	resp.Body.Close()
	time.Sleep(300 * time.Millisecond)
	if got := gameXPEvents(); got != 2 {
		t.Fatalf("re-confirm double-paid: %d events, want 2", got)
	}

	// W-L lands in /me/stats, from confirmed games only.
	resp = doJSON(t, ts, http.MethodGet, "/me/stats?tz_offset_minutes=0", winner.AccessToken, nil)
	stats := decodeJSON[struct {
		Wins   int `json:"wins"`
		Losses int `json:"losses"`
	}](t, resp)
	if stats.Wins != 1 || stats.Losses != 0 {
		t.Errorf("winner record = %d-%d, want 1-0", stats.Wins, stats.Losses)
	}
	resp = doJSON(t, ts, http.MethodGet, "/me/stats?tz_offset_minutes=0", loser.AccessToken, nil)
	loserStats := decodeJSON[struct {
		Wins   int `json:"wins"`
		Losses int `json:"losses"`
	}](t, resp)
	if loserStats.Wins != 0 || loserStats.Losses != 1 {
		t.Errorf("loser record = %d-%d, want 0-1", loserStats.Wins, loserStats.Losses)
	}
}

func TestUnconfirmedGamesExpire(t *testing.T) {
	ts, st := newTestServer(t)
	a := registerUser(t, ts, "exp-a@test.local", "ExpA")
	b := registerUser(t, ts, "exp-b@test.local", "ExpB")
	court := createTestCourt(t, ts, a.AccessToken, "Expiry Court", ruckerLat, ruckerLng)

	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/games", a.AccessToken, map[string]any{
		"team_a": []string{a.User.ID}, "team_b": []string{b.User.ID}, "winning_team": 0,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("record game: status %d", resp.StatusCode)
	}
	gameID := decodeJSON[gameResp](t, resp).Game.ID

	// Age it past the 48h window, then run the sweep the cron calls.
	if _, err := st.Pool.Exec(context.Background(),
		"UPDATE games SET created_at = now() - interval '49 hours' WHERE id = $1", gameID); err != nil {
		t.Fatalf("age game: %v", err)
	}
	if _, err := st.Queries.ExpireUnconfirmedGames(context.Background()); err != nil {
		t.Fatalf("expire sweep: %v", err)
	}
	var count int
	if err := st.Pool.QueryRow(context.Background(),
		"SELECT count(*) FROM games WHERE id = $1", gameID).Scan(&count); err != nil {
		t.Fatalf("count game: %v", err)
	}
	if count != 0 {
		t.Errorf("unconfirmed game survived the sweep")
	}

	// A confirmed game of the same age is untouched.
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/games", a.AccessToken, map[string]any{
		"team_a": []string{a.User.ID}, "team_b": []string{b.User.ID}, "winning_team": 0,
	})
	keptID := decodeJSON[gameResp](t, resp).Game.ID
	resp = doJSON(t, ts, http.MethodPost, "/games/"+keptID+"/confirm", b.AccessToken, nil)
	resp.Body.Close()
	if _, err := st.Pool.Exec(context.Background(),
		"UPDATE games SET created_at = now() - interval '49 hours' WHERE id = $1", keptID); err != nil {
		t.Fatalf("age confirmed game: %v", err)
	}
	if _, err := st.Queries.ExpireUnconfirmedGames(context.Background()); err != nil {
		t.Fatalf("expire sweep 2: %v", err)
	}
	if err := st.Pool.QueryRow(context.Background(),
		"SELECT count(*) FROM games WHERE id = $1", keptID).Scan(&count); err != nil {
		t.Fatalf("count kept game: %v", err)
	}
	if count != 1 {
		t.Errorf("confirmed game was swept away")
	}
}
