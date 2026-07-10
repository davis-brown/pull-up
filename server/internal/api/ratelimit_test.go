package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func okHandler(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) }

func do(t *testing.T, ts *httptest.Server, method, path, ip string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, ts.URL+path, strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	if ip != "" {
		req.Header.Set("CF-Connecting-IP", ip)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp
}

func TestPerIPLimit(t *testing.T) {
	r := chi.NewRouter()
	r.Use(perIPLimit(3, time.Minute))
	r.Post("/x", okHandler)
	ts := httptest.NewServer(r)
	defer ts.Close()

	for i := 0; i < 3; i++ {
		if resp := do(t, ts, http.MethodPost, "/x", "203.0.113.7"); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("request %d: status %d, want 204", i+1, resp.StatusCode)
		}
	}
	resp := do(t, ts, http.MethodPost, "/x", "203.0.113.7")
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("4th request: status %d, want 429", resp.StatusCode)
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Error("429 response missing Retry-After header")
	}
	// A different client IP has its own bucket.
	if resp := do(t, ts, http.MethodPost, "/x", "203.0.113.8"); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("other IP: status %d, want 204", resp.StatusCode)
	}
}

func TestWriteLimiterSkipsReads(t *testing.T) {
	r := chi.NewRouter()
	r.Use(writeLimiter(2, time.Minute))
	r.Get("/x", okHandler)
	r.Post("/x", okHandler)
	ts := httptest.NewServer(r)
	defer ts.Close()

	// Reads are never limited (map browsing fans out many GETs).
	for i := 0; i < 10; i++ {
		if resp := do(t, ts, http.MethodGet, "/x", "203.0.113.9"); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("GET %d: status %d, want 204", i+1, resp.StatusCode)
		}
	}
	do(t, ts, http.MethodPost, "/x", "203.0.113.9")
	do(t, ts, http.MethodPost, "/x", "203.0.113.9")
	resp := do(t, ts, http.MethodPost, "/x", "203.0.113.9")
	if resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("3rd POST: status %d, want 429", resp.StatusCode)
	}
	if resp.Header.Get("Retry-After") == "" {
		t.Error("write-limiter 429 response missing Retry-After header")
	}
}
