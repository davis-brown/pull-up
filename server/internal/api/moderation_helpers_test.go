package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/davisbrown/pull-up/server/internal/moderation"
)

// screenText decides whether user text is ever written, so its contract is
// worth pinning independently of the classifier's own tests: it must block
// only on a definite unsafe verdict, and let the post through in every
// other case including outages.
func newScreeningServer(t *testing.T, handler http.HandlerFunc) (*Server, func()) {
	t.Helper()
	upstream := httptest.NewServer(handler)
	s := &Server{
		log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		moderator: moderation.New("acct", "tok").WithEndpoint(upstream.URL),
	}
	return s, upstream.Close
}

func TestScreenTextBlocksUnsafe(t *testing.T) {
	s, done := newScreeningServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"result":{"response":"unsafe\nS1"}}`))
	})
	defer done()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	if s.screenText(rec, req, "court_message", "something vile") {
		t.Fatal("screenText allowed an unsafe post")
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422", rec.Code)
	}
	// The rejection must not name the violated category — that would hand a
	// probe a hill-climbing signal.
	if body := rec.Body.String(); containsAny(body, "S1", "unsafe") {
		t.Errorf("rejection leaks classifier detail: %s", body)
	}
}

func TestScreenTextAllowsSafe(t *testing.T) {
	s, done := newScreeningServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"result":{"response":"safe"}}`))
	})
	defer done()

	rec := httptest.NewRecorder()
	if !s.screenText(rec, httptest.NewRequest(http.MethodPost, "/x", nil), "court_message", "who's hooping at 6") {
		t.Fatal("screenText blocked a safe post")
	}
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Errorf("screenText wrote a response for a safe post: %d %s", rec.Code, rec.Body.String())
	}
}

// An outage must not stop people posting.
func TestScreenTextFailsOpenOnOutage(t *testing.T) {
	s, done := newScreeningServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	defer done()

	rec := httptest.NewRecorder()
	if !s.screenText(rec, httptest.NewRequest(http.MethodPost, "/x", nil), "court_message", "hello") {
		t.Fatal("screenText blocked a post during a classifier outage")
	}
}

// With no Workers AI credentials the guard is transparent — this is what
// keeps local development and CI running unconfigured.
func TestScreenTextDisabledPassesThrough(t *testing.T) {
	s := &Server{
		log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		moderator: moderation.New("", ""),
	}
	rec := httptest.NewRecorder()
	if !s.screenText(rec, httptest.NewRequest(http.MethodPost, "/x", nil), "court_message", "anything") {
		t.Fatal("screenText blocked a post with moderation disabled")
	}
}

// Whitespace-only text never reaches the classifier: the calling handlers
// treat it as absent, and spending an inference on it would be waste.
func TestScreenTextSkipsBlankText(t *testing.T) {
	s, done := newScreeningServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("classifier called for blank text")
	})
	defer done()

	rec := httptest.NewRecorder()
	if !s.screenText(rec, httptest.NewRequest(http.MethodPost, "/x", nil), "session_note", "   ") {
		t.Fatal("screenText blocked blank text")
	}
}

func containsAny(haystack string, needles ...string) bool {
	for _, n := range needles {
		if len(n) > 0 && len(haystack) >= len(n) {
			for i := 0; i+len(n) <= len(haystack); i++ {
				if haystack[i:i+len(n)] == n {
					return true
				}
			}
		}
	}
	return false
}

// A broken classifier fails on every post, so the outage alert must report
// promptly and then stay quiet — otherwise one bad token burns the Sentry
// quota restating a single fact.
func TestOutageThrottle(t *testing.T) {
	var th outageThrottle
	base := time.Now()
	const every = 5 * time.Minute

	if !th.allow(base, every) {
		t.Fatal("first outage was suppressed; it must report immediately")
	}
	if th.allow(base.Add(time.Second), every) {
		t.Error("a second outage one second later reported again")
	}
	if th.allow(base.Add(every-time.Millisecond), every) {
		t.Error("reported again just inside the interval")
	}
	if !th.allow(base.Add(every), every) {
		t.Error("did not report again once the interval elapsed")
	}
	// The window restarts from the last report, not from the first.
	if th.allow(base.Add(every+time.Second), every) {
		t.Error("window did not restart from the most recent report")
	}
}

// The throttle is shared across goroutines (concurrent posts all fail at
// once during an outage), so it must not race. Run with -race.
func TestOutageThrottleIsConcurrencySafe(t *testing.T) {
	var th outageThrottle
	now := time.Now()
	var wg sync.WaitGroup
	allowed := make(chan bool, 50)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			allowed <- th.allow(now, time.Hour)
		}()
	}
	wg.Wait()
	close(allowed)
	count := 0
	for a := range allowed {
		if a {
			count++
		}
	}
	if count != 1 {
		t.Errorf("%d concurrent callers were allowed to report, want exactly 1", count)
	}
}
