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

// tomorrowBucket picks a (date, window_key) pair for "tomorrow" — never
// expired by the same-day window-end check regardless of what time the
// test happens to run, and always the correct weekday/weekend window for
// that date so parseIntentBucket's day-type validation passes.
func tomorrowBucket() (dateISO, windowKey string) {
	tomorrow := time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, 1)
	dow := tomorrow.Weekday()
	if dow == time.Saturday || dow == time.Sunday {
		return tomorrow.Format("2006-01-02"), "weekend_evening"
	}
	return tomorrow.Format("2006-01-02"), "weekday_evening"
}

type runIntentSeekerRow struct {
	RunDate     string  `json:"run_date"`
	WindowKey   string  `json:"window_key"`
	UserID      string  `json:"user_id"`
	DisplayName string  `json:"display_name"`
	SkillLevel  *string `json:"skill_level"`
}

func setRunIntent(t *testing.T, ts *httptest.Server, token, courtID, date, windowKey string) map[string]any {
	t.Helper()
	resp := doJSON(t, ts, http.MethodPut, "/courts/"+courtID+"/run-intents", token, map[string]any{
		"run_date": date, "window_key": windowKey,
	})
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("set run intent: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	return decodeJSON[map[string]any](t, resp)
}

type intentPushSink struct {
	mu     sync.Mutex
	bodies []string
}

func (p *intentPushSink) count(phrase string) int {
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

func TestRunIntentsListValidateAndWithdraw(t *testing.T) {
	ts, _ := newTestServer(t)
	organizer := registerUser(t, ts, "ri-organizer@test.local", "Organizer")
	court := createTestCourt(t, ts, organizer.AccessToken, "Intent Court", ruckerLat, ruckerLng)
	date, windowKey := tomorrowBucket()

	// Validation: bad window key, past date, and day-type mismatch all 400.
	for _, body := range []map[string]any{
		{"run_date": date, "window_key": "not_a_window"},
		{"run_date": "2000-01-01", "window_key": windowKey},
		{"run_date": date, "window_key": "weekend_morning", "_skip": windowKey == "weekend_evening"},
	} {
		if skip, _ := body["_skip"].(bool); skip {
			continue
		}
		delete(body, "_skip")
		resp := doJSON(t, ts, http.MethodPut, "/courts/"+court.ID+"/run-intents", organizer.AccessToken, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("case %+v: status %d, want 400: %s", body, resp.StatusCode, readBody(t, resp))
		} else {
			resp.Body.Close()
		}
	}

	// A guest (no token) can list — public discovery is the point.
	resp := doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/run-intents", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("guest list: status %d", resp.StatusCode)
	}
	empty := decodeJSON[map[string][]runIntentSeekerRow](t, resp)
	if len(empty["seekers"]) != 0 {
		t.Fatalf("fresh court has %d seekers, want 0", len(empty["seekers"]))
	}

	joined := setRunIntent(t, ts, organizer.AccessToken, court.ID, date, windowKey)
	if joined["joined"] != true || joined["count"].(float64) != 1 {
		t.Errorf("first join: %+v, want joined=true count=1", joined)
	}

	// Idempotent: joining the same bucket again doesn't double-count.
	again := setRunIntent(t, ts, organizer.AccessToken, court.ID, date, windowKey)
	if again["count"].(float64) != 1 {
		t.Errorf("re-join: count = %v, want 1", again["count"])
	}

	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/run-intents", "", nil)
	listed := decodeJSON[map[string][]runIntentSeekerRow](t, resp)
	if len(listed["seekers"]) != 1 || listed["seekers"][0].DisplayName != "Organizer" {
		t.Fatalf("seeker list = %+v, want [Organizer]", listed["seekers"])
	}

	// Withdraw removes it.
	resp = doJSON(t, ts, http.MethodDelete, "/courts/"+court.ID+"/run-intents", organizer.AccessToken, map[string]any{
		"run_date": date, "window_key": windowKey,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("withdraw: status %d", resp.StatusCode)
	}
	withdrawn := decodeJSON[map[string]any](t, resp)
	if withdrawn["joined"] != false || withdrawn["count"].(float64) != 0 {
		t.Errorf("withdraw response: %+v, want joined=false count=0", withdrawn)
	}
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/run-intents", "", nil)
	afterWithdraw := decodeJSON[map[string][]runIntentSeekerRow](t, resp)
	if len(afterWithdraw["seekers"]) != 0 {
		t.Errorf("after withdraw: %d seekers, want 0", len(afterWithdraw["seekers"]))
	}
}

func TestRunIntentThresholdAndConversionPushes(t *testing.T) {
	sink := &intentPushSink{}
	sinkSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		sink.mu.Lock()
		sink.bodies = append(sink.bodies, string(body))
		sink.mu.Unlock()
	}))
	defer sinkSrv.Close()
	t.Setenv("EXPO_PUSH_URL", sinkSrv.URL)

	ts, _ := newTestServer(t)
	court := createTestCourt(t, ts, registerUser(t, ts, "ri-founder@test.local", "Founder").AccessToken, "Threshold Court", ruckerLat, ruckerLng)
	date, windowKey := tomorrowBucket()

	seekers := make([]testUser, 4)
	for i := range seekers {
		u := registerUser(t, ts, seekerEmail(i), seekerName(i))
		seekers[i] = u
		resp := doJSON(t, ts, http.MethodPost, "/me/push-token", u.AccessToken, map[string]string{
			"token": "ExponentPushToken[intent-" + seekerName(i) + "]",
		})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("push token for %s: status %d", seekerName(i), resp.StatusCode)
		}
		resp.Body.Close()
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

	// First three joins: no threshold push yet.
	for i := 0; i < 3; i++ {
		setRunIntent(t, ts, seekers[i].AccessToken, court.ID, date, windowKey)
	}
	time.Sleep(200 * time.Millisecond)
	if got := sink.count("plan it"); got != 0 {
		t.Fatalf("threshold push fired early: %d sends, want 0", got)
	}

	// The 4th join crosses the threshold: exactly one push.
	fourth := setRunIntent(t, ts, seekers[3].AccessToken, court.ID, date, windowKey)
	if fourth["count"].(float64) != 4 {
		t.Fatalf("bucket count = %v, want 4", fourth["count"])
	}
	if !waitFor(func() bool { return sink.count("plan it") == 1 }) {
		t.Fatalf("threshold push count = %d, want 1", sink.count("plan it"))
	}

	// A 5th joiner doesn't re-fire the threshold push.
	fifth := registerUser(t, ts, "ri-fifth@test.local", "Fifth")
	doJSON(t, ts, http.MethodPost, "/me/push-token", fifth.AccessToken, map[string]string{
		"token": "ExponentPushToken[intent-fifth]",
	}).Body.Close()
	setRunIntent(t, ts, fifth.AccessToken, court.ID, date, windowKey)
	time.Sleep(200 * time.Millisecond)
	if got := sink.count("plan it"); got != 1 {
		t.Fatalf("threshold push re-fired: %d sends, want 1", got)
	}

	// Planning a run inside this bucket's window notifies the seekers
	// (excluding the planner) exactly once — the conversion push.
	planner := seekers[0]
	tomorrow := time.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, 1).Add(18 * time.Hour)
	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/sessions", planner.AccessToken, map[string]any{
		"starts_at": tomorrow.Format(time.RFC3339),
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("plan session: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
	if !waitFor(func() bool { return sink.count("is on") == 1 }) {
		t.Fatalf("conversion push count = %d, want 1", sink.count("is on"))
	}

	// A second run planned in the same bucket doesn't re-fire.
	again := tomorrow.Add(time.Hour)
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/sessions", seekers[1].AccessToken, map[string]any{
		"starts_at": again.Format(time.RFC3339),
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("plan second session: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	time.Sleep(200 * time.Millisecond)
	if got := sink.count("is on"); got != 1 {
		t.Fatalf("conversion push re-fired: %d sends, want 1", got)
	}
}

func seekerEmail(i int) string { return "ri-seeker" + string(rune('a'+i)) + "@test.local" }
func seekerName(i int) string  { return "Seeker" + string(rune('A'+i)) }
