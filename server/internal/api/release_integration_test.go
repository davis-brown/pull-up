package api_test

import (
	"context"
	"net/http"
	"testing"
)

func TestSuspensionPreservesAccountDeletion(t *testing.T) {
	ts, st := newTestServer(t)
	admin := registerUser(t, ts, "release-admin@test.local", "Admin")
	user := registerUser(t, ts, "release-player@test.local", "Player")
	bootstrapAdmin(t, st, admin.User.ID)
	resp := doJSON(t, ts, http.MethodPost, "/admin/content/remove", admin.AccessToken, map[string]string{"entity_type": "user", "entity_id": user.User.ID})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("suspend: %d %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/courts", user.AccessToken, map[string]any{"name": "No", "lat": 40.7, "lng": -74})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("suspended player posted: %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodDelete, "/me", user.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("suspended player cannot delete account: %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestDeletionDurablyQueuesAppleRevocation(t *testing.T) {
	ts, st := newTestServer(t)
	user := registerUser(t, ts, "release-apple@test.local", "Apple Player")
	// Dummy ciphertext: no Apple credentials or external network calls in tests.
	if _, err := st.Pool.Exec(context.Background(), `UPDATE users SET apple_refresh_token=$2 WHERE id=$1`, user.User.ID, []byte("encrypted-test-token")); err != nil {
		t.Fatal(err)
	}
	resp := doJSON(t, ts, http.MethodDelete, "/me", user.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete: %d", resp.StatusCode)
	}
	resp.Body.Close()
	var count int
	if err := st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM apple_revocations WHERE encrypted_token=$1`, []byte("encrypted-test-token")).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("revocation jobs %d, want 1", count)
	}
	if err := st.Pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE id=$1`, user.User.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("user data survived deletion")
	}
}

func TestContentConsentIsVersionedAndRecorded(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "consent@test.local", "Player")
	resp := doJSON(t, ts, http.MethodGet, "/me/content-consent", u.AccessToken, nil)
	initial := decodeJSON[struct {
		Accepted bool `json:"accepted"`
	}](t, resp)
	if initial.Accepted {
		t.Fatal("legacy account consented without acknowledgement")
	}
	resp = doJSON(t, ts, http.MethodPost, "/me/content-consent", u.AccessToken, map[string]string{"version": "old"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("outdated consent accepted: %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/me/content-consent", u.AccessToken, map[string]string{"version": "2026-10-26"})
	updated := decodeJSON[struct {
		Accepted bool `json:"accepted"`
	}](t, resp)
	if !updated.Accepted {
		t.Fatal("consent not recorded")
	}
}
