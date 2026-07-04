package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/api"
	"github.com/davisbrown/pull-up/server/internal/config"
	"github.com/davisbrown/pull-up/server/internal/store"
)

// These are full-stack HTTP tests: a real Postgres/PostGIS-backed Server
// wired the same way cmd/api does, driven over HTTP. Skipped unless
// TEST_DATABASE_URL is set (see internal/store/store_integration_test.go).
//
// internal/store's integration tests point at the same database and
// truncate the same tables between tests; `go test ./...` runs different
// packages' test binaries concurrently, so both packages take this same
// Postgres advisory lock around setup+truncate to keep one package's
// reset from clobbering another package's in-flight test.
const testDBLockKey = 0x7075_6c6c_7570 // "pullup" — arbitrary, just needs to match internal/store's

func acquireTestDBLock(t *testing.T, ctx context.Context, databaseURL string) {
	t.Helper()
	conn, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		t.Fatalf("test db lock connect: %v", err)
	}
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", int64(testDBLockKey)); err != nil {
		t.Fatalf("acquire test db lock: %v", err)
	}
	t.Cleanup(func() {
		conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", int64(testDBLockKey))
		conn.Close(context.Background())
	})
}

func newTestServer(t *testing.T) (*httptest.Server, *store.Store) {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping API integration tests")
	}
	ctx := context.Background()
	acquireTestDBLock(t, ctx, url)
	st, err := store.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(st.Close)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := st.Pool.Exec(ctx,
		"TRUNCATE users, refresh_tokens, courts, check_ins, crowd_reports, court_votes, court_photos, flags, seed_regions, admin_actions CASCADE"); err != nil {
		t.Fatalf("truncate: %v", err)
	}

	cfg := &config.Config{
		Port:            "0",
		DatabaseURL:     url,
		JWTSecret:       []byte("test-secret"),
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 30 * 24 * time.Hour,
		CORSOrigins:     []string{"*"},
		AutoSeed:        false,
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	ts := httptest.NewServer(api.NewServer(cfg, st, log, nil).Routes())
	t.Cleanup(ts.Close)
	return ts, st
}

type testUser struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	User         struct {
		ID          string `json:"id"`
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
		IsAdmin     bool   `json:"is_admin"`
	} `json:"user"`
}

// registerUser signs up a fresh user over HTTP and returns their tokens.
func registerUser(t *testing.T, ts *httptest.Server, email, displayName string) testUser {
	t.Helper()
	resp := doJSON(t, ts, http.MethodPost, "/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": displayName,
	})
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("register %s: status %d: %s", email, resp.StatusCode, readBody(t, resp))
	}
	return decodeJSON[testUser](t, resp)
}

// doJSON issues an HTTP request against the test server's API prefix,
// optionally authenticated and with a JSON body.
func doJSON(t *testing.T, ts *httptest.Server, method, path, token string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, ts.URL+"/api/v1"+path, reader)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func decodeJSON[T any](t *testing.T, resp *http.Response) T {
	t.Helper()
	defer resp.Body.Close()
	var v T
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return v
}

func readBody(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, _ := io.ReadAll(resp.Body)
	return string(b)
}
