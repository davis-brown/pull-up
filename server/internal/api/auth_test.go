package api_test

import (
	"net/http"
	"testing"
)

func TestAuthRegisterLoginFlow(t *testing.T) {
	ts, _ := newTestServer(t)

	u := registerUser(t, ts, "alice@test.local", "Alice")
	if u.User.Email != "alice@test.local" || u.User.IsAdmin {
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
