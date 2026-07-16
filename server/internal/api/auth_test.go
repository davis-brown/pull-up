package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/davisbrown/pull-up/server/internal/auth"
)

func TestAuthRegisterLoginFlow(t *testing.T) {
	ts, _ := newTestServer(t)

	u := registerUser(t, ts, "alice@test.local", "Alice")
	if u.User.Email != "alice@test.local" || u.User.IsAdmin || !u.User.EmailVerified {
		t.Fatalf("unexpected registered user: %+v", u.User)
	}
	if u.AccessToken == "" || u.RefreshToken == "" {
		t.Fatal("register did not return tokens")
	}

	// Duplicate email is rejected.
	resp := doJSON(t, ts, http.MethodPost, "/auth/register", "", map[string]string{
		"email": "alice@test.local", "password": "password123", "display_name": "Alice 2",
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate register: status %d, want 409", resp.StatusCode)
	}
	resp.Body.Close()

	// Wrong password is rejected.
	resp = doJSON(t, ts, http.MethodPost, "/auth/login", "", map[string]string{
		"email": "alice@test.local", "password": "wrong-password",
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("bad login: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	// Correct login returns the same user.
	resp = doJSON(t, ts, http.MethodPost, "/auth/login", "", map[string]string{
		"email": "alice@test.local", "password": "password123",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login: status %d", resp.StatusCode)
	}
	login := decodeJSON[testUser](t, resp)
	if login.User.ID != u.User.ID {
		t.Fatalf("login returned different user: %s vs %s", login.User.ID, u.User.ID)
	}

	// GET /me requires the access token.
	resp = doJSON(t, ts, http.MethodGet, "/me", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated /me: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/me", "not-a-real-token", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("garbage token /me: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/me", u.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authenticated /me: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Refresh rotates the token; the old refresh token can't be reused.
	resp = doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{
		"refresh_token": u.RefreshToken,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("refresh: status %d", resp.StatusCode)
	}
	refreshed := decodeJSON[testUser](t, resp)
	if refreshed.AccessToken == "" || refreshed.RefreshToken == u.RefreshToken {
		t.Fatal("refresh did not rotate tokens")
	}
	resp = doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{
		"refresh_token": u.RefreshToken,
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused refresh token: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	// Logout revokes the current refresh token.
	resp = doJSON(t, ts, http.MethodPost, "/auth/logout", "", map[string]string{
		"refresh_token": refreshed.RefreshToken,
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("logout: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{
		"refresh_token": refreshed.RefreshToken,
	})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("refresh after logout: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestPasswordRegistrationRequiresEmailVerification(t *testing.T) {
	ts, st := newTestServer(t)
	const email = "pending@test.local"

	resp := doJSON(t, ts, http.MethodPost, "/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": "Pending",
	})
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("register: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	if token := resp.Header.Get("X-Pull-Up-Email-Verification-Token"); token != "" {
		t.Fatal("untrusted registration response exposed a verification token header")
	}
	body := readBody(t, resp)
	resp.Body.Close()
	if strings.Contains(body, "verification_token") || strings.Contains(body, "access_token") {
		t.Fatalf("pending registration exposed token data: %s", body)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("registration Cache-Control = %q, want no-store", resp.Header.Get("Cache-Control"))
	}

	resp = doJSON(t, ts, http.MethodPost, "/auth/login", "", map[string]string{
		"email": email, "password": "password123",
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("unverified login: status %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// An untrusted resend request is a non-mutating, non-enumerating no-op.
	resp = doJSON(t, ts, http.MethodPost, "/auth/email-verification/request", "", map[string]string{"email": email})
	if resp.StatusCode != http.StatusAccepted || resp.Header.Get("X-Pull-Up-Email-Verification-Token") != "" {
		t.Fatalf("untrusted resend response: status=%d token=%q", resp.StatusCode, resp.Header.Get("X-Pull-Up-Email-Verification-Token"))
	}
	resp.Body.Close()

	// The trusted email Worker gets the raw one-time token in an origin-only
	// header. Only its SHA-256 hash is retained in Postgres.
	resp = doJSONHeaders(t, ts, http.MethodPost, "/auth/email-verification/request", "",
		map[string]string{"email": email}, map[string]string{"X-Internal-Task": "test-internal-secret"})
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("trusted resend: status %d", resp.StatusCode)
	}
	verificationToken := resp.Header.Get("X-Pull-Up-Email-Verification-Token")
	verificationRecipient := resp.Header.Get("X-Pull-Up-Email-Verification-To")
	resp.Body.Close()
	if verificationToken == "" {
		t.Fatal("trusted resend missing verification token header")
	}
	if verificationRecipient != email {
		t.Fatalf("trusted resend recipient = %q, want %q", verificationRecipient, email)
	}
	var storedHash string
	if err := st.Pool.QueryRow(context.Background(), `
		SELECT token_hash FROM email_verification_tokens evt
		JOIN users u ON u.id = evt.user_id
		WHERE u.email = $1 AND evt.consumed_at IS NULL`, email).Scan(&storedHash); err != nil {
		t.Fatalf("query stored verification hash: %v", err)
	}
	if storedHash == verificationToken || storedHash != auth.HashEmailVerificationToken(verificationToken) {
		t.Fatal("verification token was not stored solely as its expected hash")
	}

	resp = doJSON(t, ts, http.MethodPost, "/auth/email-verification/verify", "", map[string]string{"token": verificationToken})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("verify: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	verified := decodeJSON[testUser](t, resp)
	if verified.AccessToken == "" || !verified.User.EmailVerified {
		t.Fatalf("verified response missing authenticated verified user: %+v", verified)
	}

	resp = doJSON(t, ts, http.MethodPost, "/auth/email-verification/verify", "", map[string]string{"token": verificationToken})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("verification token reuse: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestWebAuthUsesSameOriginHttpOnlyRefreshCookie(t *testing.T) {
	ts, _ := newTestServer(t)
	registerUser(t, ts, "web-cookie@test.local", "Web Cookie")
	webHeaders := map[string]string{
		"Origin":             "http://app.test",
		"X-Forwarded-Host":   "app.test",
		"X-Forwarded-Proto":  "http",
		"X-Pull-Up-Platform": "web",
	}

	resp := doJSONHeaders(t, ts, http.MethodPost, "/auth/login", "", map[string]string{
		"email": "web-cookie@test.local", "password": "password123",
	}, webHeaders)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("web login: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	cookies := resp.Cookies()
	if len(cookies) != 1 || cookies[0].Name != "pullup_refresh" || !cookies[0].HttpOnly ||
		cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("web login cookie = %+v", cookies)
	}
	login := decodeJSON[testUser](t, resp)
	if login.AccessToken == "" || login.RefreshToken != "" {
		t.Fatalf("web login exposed wrong tokens: %+v", login)
	}

	refreshHeaders := map[string]string{}
	for key, value := range webHeaders {
		refreshHeaders[key] = value
	}
	refreshHeaders["Cookie"] = cookies[0].Name + "=" + cookies[0].Value
	resp = doJSONHeaders(t, ts, http.MethodPost, "/auth/refresh", "", map[string]any{}, refreshHeaders)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cookie refresh: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	rotated := resp.Cookies()
	if len(rotated) != 1 || rotated[0].Value == cookies[0].Value {
		t.Fatalf("cookie was not rotated: before=%+v after=%+v", cookies, rotated)
	}
	refreshed := decodeJSON[testUser](t, resp)
	if refreshed.RefreshToken != "" {
		t.Fatal("cookie refresh exposed refresh token in JSON")
	}

	badOrigin := map[string]string{
		"Origin":             "https://attacker.test",
		"X-Forwarded-Host":   "app.test",
		"X-Forwarded-Proto":  "https",
		"X-Pull-Up-Platform": "web",
	}
	resp = doJSONHeaders(t, ts, http.MethodPost, "/auth/login", "", map[string]string{
		"email": "web-cookie@test.local", "password": "password123",
	}, badOrigin)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin web login: status %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestRefreshReuseRevokesOnlyItsFamily(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "families@test.local", "Families")

	// A separate login creates a separate refresh family for another device.
	resp := doJSON(t, ts, http.MethodPost, "/auth/login", "", map[string]string{
		"email": "families@test.local", "password": "password123",
	})
	deviceB := decodeJSON[testUser](t, resp)

	resp = doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{"refresh_token": u.RefreshToken})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rotate family A: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{"refresh_token": u.RefreshToken})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reuse family A: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{"refresh_token": deviceB.RefreshToken})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("family A reuse revoked independent family B: status %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestExpiredRotatedTokenCannotRevokeCurrentFamily(t *testing.T) {
	ts, st := newTestServer(t)
	u := registerUser(t, ts, "expired-reuse@test.local", "Expired Reuse")

	resp := doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{"refresh_token": u.RefreshToken})
	current := decodeJSON[testUser](t, resp)
	if _, err := st.Pool.Exec(context.Background(), `
		UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`,
		auth.HashRefreshToken(u.RefreshToken)); err != nil {
		t.Fatalf("expire old token: %v", err)
	}

	resp = doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{"refresh_token": u.RefreshToken})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired old token: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/auth/refresh", "", map[string]string{"refresh_token": current.RefreshToken})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expired old token revoked current token: status %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestConcurrentRefreshOnlyOneRotationSucceeds(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "refresh-race@test.local", "Refresh Race")

	start := make(chan struct{})
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			payload, _ := json.Marshal(map[string]string{"refresh_token": u.RefreshToken})
			req, _ := http.NewRequest(http.MethodPost, ts.URL+"/api/v1/auth/refresh", strings.NewReader(string(payload)))
			req.Header.Set("Content-Type", "application/json")
			resp, err := ts.Client().Do(req)
			if err != nil {
				statuses <- 0
				return
			}
			resp.Body.Close()
			statuses <- resp.StatusCode
		}()
	}
	close(start)
	wg.Wait()
	close(statuses)

	ok, unauthorized := 0, 0
	for status := range statuses {
		switch status {
		case http.StatusOK:
			ok++
		case http.StatusUnauthorized:
			unauthorized++
		default:
			t.Errorf("concurrent refresh returned unexpected status %d", status)
		}
	}
	if ok != 1 || unauthorized != 1 {
		t.Fatalf("concurrent refresh statuses: ok=%d unauthorized=%d, want 1 each", ok, unauthorized)
	}
}

func TestOAuthDisabledWithoutClientIDs(t *testing.T) {
	ts, _ := newTestServer(t)

	// The test server is configured with no Google/Apple client IDs, so
	// both providers must report as unconfigured rather than attempt a
	// network JWKS fetch.
	resp := doJSON(t, ts, http.MethodPost, "/auth/oauth", "", map[string]string{
		"provider": "google", "id_token": "whatever",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("oauth with no client ids: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
}
