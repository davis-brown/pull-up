package api_test

import (
	"net/http"
	"testing"
)

func TestInternalDrainRequiresSecret(t *testing.T) {
	ts, _ := newTestServer(t)
	// No secret header → 401.
	resp := doJSON(t, ts, http.MethodPost, "/internal/drain", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no-secret drain: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestInternalDrainSucceedsWithSecret(t *testing.T) {
	ts, _ := newTestServer(t)
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/internal/drain", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("X-Internal-Task", "test-internal-secret")
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("drain request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("drain with secret: status %d, want 200", resp.StatusCode)
	}
}
