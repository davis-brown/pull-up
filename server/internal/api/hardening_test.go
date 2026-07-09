package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestSecurityHeaders(t *testing.T) {
	r := chi.NewRouter()
	r.Use(securityHeaders)
	r.Get("/x", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	ts := httptest.NewServer(r)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/x")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if got := resp.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff", got)
	}
	if got := resp.Header.Get("Referrer-Policy"); got != "no-referrer" {
		t.Errorf("Referrer-Policy = %q, want no-referrer", got)
	}
}

func TestLimitBody(t *testing.T) {
	r := chi.NewRouter()
	r.Use(limitBody)
	r.Post("/x", func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	ts := httptest.NewServer(r)
	defer ts.Close()

	small, err := http.Post(ts.URL+"/x", "application/json", strings.NewReader(`{"ok":true}`))
	if err != nil {
		t.Fatal(err)
	}
	small.Body.Close()
	if small.StatusCode != http.StatusNoContent {
		t.Errorf("small body: status %d, want 204", small.StatusCode)
	}

	big, err := http.Post(ts.URL+"/x", "application/json",
		strings.NewReader(strings.Repeat("a", 2<<20))) // 2 MB
	if err != nil {
		t.Fatal(err)
	}
	big.Body.Close()
	if big.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("2MB body: status %d, want 413", big.StatusCode)
	}
}
