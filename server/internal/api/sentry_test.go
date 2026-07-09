package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

// sentryReporter must re-panic after capturing so chi's Recoverer still
// turns panics into 500s, and must pass normal responses through untouched.
func TestSentryReporterRepanics(t *testing.T) {
	r := chi.NewRouter()
	r.Use(chimw.Recoverer)
	r.Use(sentryReporter)
	r.Get("/boom", func(http.ResponseWriter, *http.Request) { panic("boom") })
	r.Get("/ok", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	r.Get("/fail", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	for _, tc := range []struct {
		path string
		want int
	}{
		{"/boom", http.StatusInternalServerError},
		{"/ok", http.StatusNoContent},
		{"/fail", http.StatusBadGateway},
	} {
		resp, err := http.Get(ts.URL + tc.path)
		if err != nil {
			t.Fatalf("GET %s: %v", tc.path, err)
		}
		resp.Body.Close()
		if resp.StatusCode != tc.want {
			t.Errorf("GET %s: status %d, want %d", tc.path, resp.StatusCode, tc.want)
		}
	}
}
