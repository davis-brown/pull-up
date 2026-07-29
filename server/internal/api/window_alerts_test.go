package api_test

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// eveningZoneForNow picks a whole-hour Etc/GMT zone where local time is
// currently 6 PM, so the alert path runs against real "now" deterministically.
func eveningZoneForNow(t *testing.T) (zone string, availabilityKey string) {
	t.Helper()
	now := time.Now()
	for off := -12; off <= 14; off++ {
		// Etc/GMT names invert the sign: Etc/GMT-5 is UTC+5.
		name := "Etc/GMT"
		if off > 0 {
			name = fmt.Sprintf("Etc/GMT-%d", off)
		} else if off < 0 {
			name = fmt.Sprintf("Etc/GMT+%d", -off)
		}
		loc, err := time.LoadLocation(name)
		if err != nil {
			continue
		}
		local := now.In(loc)
		if local.Hour() != 18 {
			continue
		}
		if dow := local.Weekday(); dow == time.Saturday || dow == time.Sunday {
			return name, "weekend_evening"
		}
		return name, "weekday_evening"
	}
	t.Fatal("no Etc/GMT zone currently at 6 PM local")
	return "", ""
}

// pushSink is a local stand-in for Expo's push endpoint.
type pushSink struct {
	mu     sync.Mutex
	bodies []string
}

// windowAlertPhrase is copy unique to window-alert pushes. Match on the body,
// never a substring the recipient token in "to" could also contain.
const windowAlertPhrase = "A run is on during your"

func (p *pushSink) windowAlertCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	n := 0
	for _, b := range p.bodies {
		if strings.Contains(b, windowAlertPhrase) {
			n++
		}
	}
	return n
}

func TestWindowAlertCrossingCooldownAndToggle(t *testing.T) {
	sink := &pushSink{}
	sinkSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		sink.mu.Lock()
		sink.bodies = append(sink.bodies, string(body))
		sink.mu.Unlock()
	}))
	defer sinkSrv.Close()
	t.Setenv("EXPO_PUSH_URL", sinkSrv.URL)

	ts, st := newTestServer(t)
	organizer := registerUser(t, ts, "wa-organizer@test.local", "Organizer")
	favoriter := registerUser(t, ts, "wa-favoriter@test.local", "Favoriter")
	court := createTestCourt(t, ts, organizer.AccessToken, "Alert Court", ruckerLat, ruckerLng)

	zone, availabilityKey := eveningZoneForNow(t)

	resp := doJSON(t, ts, http.MethodPut, "/courts/"+court.ID+"/favorite", favoriter.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		t.Fatalf("favorite: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/me/push-token", favoriter.AccessToken, map[string]string{
		"token": "ExponentPushToken[favoriter-device]", "timezone": zone,
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("push token: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPatch, "/me", favoriter.AccessToken, map[string]any{
		"availability": []string{availabilityKey},
	})
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("patch availability: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	me := decodeJSON[map[string]any](t, resp)
	if enabled, ok := me["window_alerts_enabled"].(bool); !ok || !enabled {
		t.Fatalf("window_alerts_enabled missing or false in PATCH /me response: %v", me["window_alerts_enabled"])
	}

	alertRows := func() int {
		var n int
		if err := st.Pool.QueryRow(context.Background(),
			"SELECT count(*) FROM window_alerts WHERE court_id = $1", court.ID).Scan(&n); err != nil {
			t.Fatalf("count window_alerts: %v", err)
		}
		return n
	}
	waitForAlertRows := func(want int) bool {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if alertRows() == want {
				return true
			}
			time.Sleep(50 * time.Millisecond)
		}
		return alertRows() == want
	}
	checkIn := func(u testUser, partySize int) {
		t.Helper()
		resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
			"lat": ruckerLat, "lng": ruckerLng, "party_size": partySize,
		})
		if resp.StatusCode != http.StatusCreated {
			defer resp.Body.Close()
			t.Fatalf("check in: status %d: %s", resp.StatusCode, readBody(t, resp))
		}
		resp.Body.Close()
	}
	resetCourtActivity := func() {
		t.Helper()
		if _, err := st.Pool.Exec(context.Background(),
			"UPDATE check_ins SET checked_out_at = now(), expires_at = now() - interval '1 minute' WHERE court_id = $1",
			court.ID); err != nil {
			t.Fatalf("reset court activity: %v", err)
		}
	}

	// A party of 4 crosses the threshold in one go: exactly one alert, with
	// the window called out in the copy.
	checkIn(organizer, 4)
	if !waitForAlertRows(1) {
		t.Fatalf("threshold crossing: window_alerts rows = %d, want 1", alertRows())
	}
	deadline := time.Now().Add(3 * time.Second)
	for sink.windowAlertCount() < 1 && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if got := sink.windowAlertCount(); got != 1 {
		t.Fatalf("window-alert pushes = %d, want 1", got)
	}
	sink.mu.Lock()
	var alertBody string
	for _, b := range sink.bodies {
		if strings.Contains(b, windowAlertPhrase) {
			alertBody = b
		}
	}
	sink.mu.Unlock()
	for _, want := range []string{"Alert Court", "4 playing", "evening window"} {
		if !strings.Contains(alertBody, want) {
			t.Errorf("alert push missing %q: %s", want, alertBody)
		}
	}

	// Above the threshold is not a crossing: no re-fire as more players land.
	extra := registerUser(t, ts, "wa-extra@test.local", "Extra")
	checkIn(extra, 1)
	time.Sleep(300 * time.Millisecond)
	if got := alertRows(); got != 1 {
		t.Fatalf("post-threshold check-in: window_alerts rows = %d, want 1", got)
	}

	// A fresh crossing inside the 20h cooldown stays quiet.
	resetCourtActivity()
	second := registerUser(t, ts, "wa-second@test.local", "Second")
	checkIn(second, 4)
	time.Sleep(300 * time.Millisecond)
	if got := alertRows(); got != 1 {
		t.Fatalf("cooldown crossing: window_alerts rows = %d, want 1", got)
	}

	// With the toggle off (and the cooldown cleared), a crossing is ignored.
	resp = doJSON(t, ts, http.MethodPatch, "/me", favoriter.AccessToken, map[string]any{
		"window_alerts_enabled": false,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("disable alerts: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	if _, err := st.Pool.Exec(context.Background(),
		"DELETE FROM window_alerts WHERE court_id = $1", court.ID); err != nil {
		t.Fatalf("clear cooldown: %v", err)
	}
	resetCourtActivity()
	third := registerUser(t, ts, "wa-third@test.local", "Third")
	checkIn(third, 4)
	time.Sleep(300 * time.Millisecond)
	if got := alertRows(); got != 0 {
		t.Fatalf("disabled toggle: window_alerts rows = %d, want 0", got)
	}
}
