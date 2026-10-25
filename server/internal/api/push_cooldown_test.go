package api_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// A check-in/check-out loop or a planning loop must not push the court's
// favoriters on every cycle.
func TestRunPushesHaveCooldowns(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	sinkSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(body))
		mu.Unlock()
	}))
	defer sinkSrv.Close()
	t.Setenv("EXPO_PUSH_URL", sinkSrv.URL)
	count := func(phrase string) int {
		mu.Lock()
		defer mu.Unlock()
		n := 0
		for _, b := range bodies {
			if strings.Contains(b, phrase) {
				n++
			}
		}
		return n
	}

	ts, _ := newTestServer(t)
	fan := registerUser(t, ts, "cooldown-fan@test.local", "Fan")
	player := registerUser(t, ts, "cooldown-player@test.local", "Player")
	court := createTestCourt(t, ts, fan.AccessToken, "Cooldown Court", ruckerLat, ruckerLng)
	for _, req := range []struct {
		method, path string
		body         any
	}{
		{http.MethodPost, "/me/push-token", map[string]string{"token": "ExponentPushToken[cooldown-fan]"}},
		{http.MethodPut, "/courts/" + court.ID + "/favorite", nil},
	} {
		resp := doJSON(t, ts, req.method, req.path, fan.AccessToken, req.body)
		if resp.StatusCode >= 300 {
			t.Fatalf("%s %s: status %d", req.method, req.path, resp.StatusCode)
		}
		resp.Body.Close()
	}

	for i := 0; i < 3; i++ {
		resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", player.AccessToken,
			map[string]any{"lat": ruckerLat, "lng": ruckerLng})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("check-in %d: status %d: %s", i, resp.StatusCode, readBody(t, resp))
		}
		resp.Body.Close()
		resp = doJSON(t, ts, http.MethodDelete, "/check-ins/current", player.AccessToken, nil)
		resp.Body.Close()
	}
	for i := 0; i < 3; i++ {
		resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/sessions", player.AccessToken,
			map[string]any{"starts_at": time.Now().Add(time.Duration(i+2) * time.Hour)})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("session %d: status %d: %s", i, resp.StatusCode, readBody(t, resp))
		}
		resp.Body.Close()
	}

	time.Sleep(500 * time.Millisecond)
	if n := count("Run starting at"); n != 1 {
		t.Errorf("run-started pushes = %d, want 1", n)
	}
	if n := count("Run planned at"); n != 1 {
		t.Errorf("run-planned pushes = %d, want 1", n)
	}
}
