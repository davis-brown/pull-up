package api_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type xpPushSink struct {
	mu     sync.Mutex
	bodies []string
}

func (p *xpPushSink) count(phrase string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, b := range p.bodies {
		if strings.Contains(b, phrase) {
			n++
		}
	}
	return n
}

type meStatsXP struct {
	Level          int    `json:"level"`
	Tier           string `json:"tier"`
	XP             int    `json:"xp"`
	XPIntoLevel    int    `json:"xp_into_level"`
	XPForNextLevel int    `json:"xp_for_next_level"`
	WeekStreak     int    `json:"week_streak"`
	XPBreakdown    []struct {
		Kind   string `json:"kind"`
		Points int    `json:"points"`
		Events int    `json:"events"`
	} `json:"xp_breakdown"`
	LevelUpPending *int `json:"level_up_pending"`
}

func TestCheckInAwardsXPIdempotentlyAndLevelsUp(t *testing.T) {
	sink := &xpPushSink{}
	sinkSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		sink.mu.Lock()
		sink.bodies = append(sink.bodies, string(body))
		sink.mu.Unlock()
	}))
	defer sinkSrv.Close()
	t.Setenv("EXPO_PUSH_URL", sinkSrv.URL)

	ts, st := newTestServer(t)
	u := registerUser(t, ts, "xp-player@test.local", "XPPlayer")
	court := createTestCourt(t, ts, u.AccessToken, "XP Court", ruckerLat, ruckerLng)
	resp := doJSON(t, ts, http.MethodPost, "/me/push-token", u.AccessToken, map[string]string{
		"token": "ExponentPushToken[xp-player]",
	})
	resp.Body.Close()

	xpTotal := func() int {
		var xp int
		if err := st.Pool.QueryRow(context.Background(),
			"SELECT xp FROM users WHERE id = $1", u.User.ID).Scan(&xp); err != nil {
			t.Fatalf("read xp: %v", err)
		}
		return xp
	}
	waitFor := func(cond func() bool) bool {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if cond() {
				return true
			}
			time.Sleep(50 * time.Millisecond)
		}
		return cond()
	}
	checkIn := func() {
		t.Helper()
		resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
			"lat": ruckerLat, "lng": ruckerLng,
		})
		if resp.StatusCode != http.StatusCreated {
			defer resp.Body.Close()
			t.Fatalf("check in: status %d: %s", resp.StatusCode, readBody(t, resp))
		}
		resp.Body.Close()
	}

	// First check-in: 10 (check-in) + 5 (first of the day) + 10 (a 1-week
	// streak bonus) = 25. Crossing 0 XP also can't level: level 2 is 50.
	checkIn()
	if !waitFor(func() bool { return xpTotal() == 25 }) {
		t.Fatalf("after first check-in xp = %d, want 25", xpTotal())
	}

	// A second check-in at the same court inside 20h earns nothing: the
	// check-in award rides the same anti-farm gate as reputation, and the
	// daily/streak awards are already deduped for today.
	checkIn()
	time.Sleep(400 * time.Millisecond)
	if got := xpTotal(); got != 25 {
		t.Fatalf("repeat check-in farmed xp: %d, want 25", got)
	}

	resp = doJSON(t, ts, http.MethodGet, "/me/stats?tz_offset_minutes=0", u.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("me stats: status %d", resp.StatusCode)
	}
	stats := decodeJSON[meStatsXP](t, resp)
	if stats.XP != 25 || stats.Level != 1 || stats.Tier != "Rookie" {
		t.Errorf("stats = %+v, want xp 25 at level 1 Rookie", stats)
	}
	if stats.XPIntoLevel != 25 || stats.XPForNextLevel != 50 {
		t.Errorf("progress = %d/%d, want 25/50", stats.XPIntoLevel, stats.XPForNextLevel)
	}

	// Pushing the total over the level-2 threshold fires exactly one
	// level-up push. Granting directly through the ledger keeps the test
	// about the crossing rather than about farming enough check-ins.
	if _, err := st.Pool.Exec(context.Background(),
		`INSERT INTO xp_events (user_id, kind, points, dedup_key) VALUES ($1, 'test_grant', 24, 'test:grant')`,
		u.User.ID); err != nil {
		t.Fatalf("seed xp event: %v", err)
	}
	if _, err := st.Pool.Exec(context.Background(),
		"UPDATE users SET xp = xp + 24 WHERE id = $1", u.User.ID); err != nil {
		t.Fatalf("seed xp total: %v", err)
	}
	// 49 XP: one short of level 2. A fresh court gives an un-deduped
	// check-in award, which crosses the boundary.
	far := createTestCourt(t, ts, u.AccessToken, "XP Court Two", ruckerLat+0.05, ruckerLng)
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+far.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat + 0.05, "lng": ruckerLng,
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("second-court check in: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
	if !waitFor(func() bool { return sink.count("Level 2") == 1 }) {
		t.Fatalf("level-up pushes = %d, want 1 (xp now %d)", sink.count("Level 2"), xpTotal())
	}

	// Phase 21: the crossing is also recorded for the app to celebrate,
	// because the award happened off the request path and no response could
	// have carried it.
	var pending *int
	if !waitFor(func() bool {
		resp := doJSON(t, ts, http.MethodGet, "/me/stats?tz_offset_minutes=0", u.AccessToken, nil)
		defer resp.Body.Close()
		pending = decodeJSON[meStatsXP](t, resp).LevelUpPending
		return pending != nil
	}) {
		t.Fatalf("level_up_pending = nil, want the level just crossed")
	}
	if *pending != 2 {
		t.Errorf("level_up_pending = %d, want 2", *pending)
	}

	// Acking clears it, so the celebration shows once and not on every
	// subsequent stats fetch.
	resp = doJSON(t, ts, http.MethodPost, "/me/level-up/ack", u.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		defer resp.Body.Close()
		t.Fatalf("ack level up: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/me/stats?tz_offset_minutes=0", u.AccessToken, nil)
	stats = decodeJSON[meStatsXP](t, resp)
	if stats.LevelUpPending != nil {
		t.Errorf("level_up_pending = %d after ack, want null", *stats.LevelUpPending)
	}

	// The breakdown explains the total rather than just reporting it: the
	// kinds actually earned are present, and their points sum to the XP the
	// ledger holds for the window.
	if len(stats.XPBreakdown) == 0 {
		t.Fatalf("xp_breakdown is empty, want the kinds that earned %d XP", stats.XP)
	}
	sum := 0
	kinds := map[string]bool{}
	for _, entry := range stats.XPBreakdown {
		sum += entry.Points
		kinds[entry.Kind] = true
		if entry.Events < 1 {
			t.Errorf("breakdown entry %q has %d events, want at least 1", entry.Kind, entry.Events)
		}
	}
	if sum != stats.XP {
		t.Errorf("breakdown sums to %d, want the %d XP total", sum, stats.XP)
	}
	for _, want := range []string{"check_in", "daily_first"} {
		if !kinds[want] {
			t.Errorf("breakdown missing %q; got %v", want, kinds)
		}
	}
}

func TestXPDailyCapStopsFarming(t *testing.T) {
	ts, st := newTestServer(t)
	u := registerUser(t, ts, "xp-farmer@test.local", "XPFarmer")

	// Spend the whole daily budget in one seeded event, then verify a real
	// earning action adds nothing more today.
	if _, err := st.Pool.Exec(context.Background(),
		`INSERT INTO xp_events (user_id, kind, points, dedup_key) VALUES ($1, 'test_grant', 75, 'test:cap')`,
		u.User.ID); err != nil {
		t.Fatalf("seed capped day: %v", err)
	}
	if _, err := st.Pool.Exec(context.Background(),
		"UPDATE users SET xp = 75 WHERE id = $1", u.User.ID); err != nil {
		t.Fatalf("seed xp total: %v", err)
	}

	court := createTestCourt(t, ts, u.AccessToken, "Cap Court", ruckerLat, ruckerLng)
	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat, "lng": ruckerLng,
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("check in: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	time.Sleep(500 * time.Millisecond)
	var xp int
	if err := st.Pool.QueryRow(context.Background(),
		"SELECT xp FROM users WHERE id = $1", u.User.ID).Scan(&xp); err != nil {
		t.Fatalf("read xp: %v", err)
	}
	if xp != 75 {
		t.Errorf("xp = %d after a capped day, want 75", xp)
	}
}

func TestPlayNudgeToggleAndProfileLevel(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "xp-toggle@test.local", "XPToggle")

	resp := doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{
		"play_nudges_enabled": false,
	})
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("disable nudges: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	me := decodeJSON[map[string]any](t, resp)
	if me["play_nudges_enabled"] != false {
		t.Errorf("play_nudges_enabled = %v, want false", me["play_nudges_enabled"])
	}

	resp = doJSON(t, ts, http.MethodGet, "/users/"+u.User.ID, "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("profile: status %d", resp.StatusCode)
	}
	profile := decodeJSON[map[string]any](t, resp)
	if profile["level"] == nil || profile["tier"] != "Rookie" {
		t.Errorf("profile level/tier = %v/%v, want a level and Rookie", profile["level"], profile["tier"])
	}
}
