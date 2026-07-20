package api

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

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
