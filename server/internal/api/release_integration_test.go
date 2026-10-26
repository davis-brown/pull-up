package api_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
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

func reviewMedia(t *testing.T, ts *httptest.Server, token, key string, approve bool) {
	t.Helper()
	resp := doJSON(t, ts, http.MethodPost, "/admin/media/review", token, map[string]any{"key": key, "approve": approve})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("review media: %d %s", resp.StatusCode, readBody(t, resp))
	}
}

func TestMediaRejectionKeepsUploadsPrivate(t *testing.T) {
	ts, st := newTestServer(t)
	admin := registerUser(t, ts, "media-admin@test.local", "Moderator")
	bootstrapAdmin(t, st, admin.User.ID)
	owner := registerUser(t, ts, "media-owner@test.local", "Player")
	court := createTestCourt(t, ts, owner.AccessToken, "Review Court", ruckerLat, ruckerLng)
	for _, purpose := range []string{"court", "avatar"} {
		t.Run(purpose, func(t *testing.T) {
			endpoint := "/me/avatar"
			if purpose == "court" {
				endpoint = "/courts/" + court.ID + "/photos"
			}
			resp := doJSON(t, ts, http.MethodPost, endpoint, owner.AccessToken, map[string]any{})
			upload := decodeJSON[struct {
				UploadPath string `json:"upload_path"`
				AvatarURL  string `json:"avatar_url"`
			}](t, resp)
			key := strings.TrimPrefix(upload.UploadPath, "/photos/upload/")
			resp = doJSONHeaders(t, ts, http.MethodPost, "/internal/media/uploaded", "", map[string]string{"key": key}, map[string]string{"X-Internal-Task": "test-internal-secret"})
			if resp.StatusCode != http.StatusNoContent {
				t.Fatalf("finalize: %d %s", resp.StatusCode, readBody(t, resp))
			}
			resp.Body.Close()
			if purpose == "avatar" {
				resp = doJSON(t, ts, http.MethodPatch, "/me", owner.AccessToken, map[string]string{"avatar_url": upload.AvatarURL})
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("submit avatar: %d %s", resp.StatusCode, readBody(t, resp))
				}
				resp.Body.Close()
			}
			// Ordinary players cannot publish their own uploads.
			resp = doJSON(t, ts, http.MethodPost, "/admin/media/review", owner.AccessToken, map[string]any{"key": key, "approve": true})
			if resp.StatusCode != http.StatusForbidden {
				t.Fatalf("non-admin review: %d", resp.StatusCode)
			}
			resp.Body.Close()
			reviewMedia(t, ts, admin.AccessToken, key, false)
			resp = doJSONHeaders(t, ts, http.MethodPost, "/internal/media/authorize", "", map[string]any{"key": key, "review": true}, map[string]string{"X-Internal-Task": "test-internal-secret"})
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("rejected image remains readable: %d", resp.StatusCode)
			}
			resp.Body.Close()
			var queued bool
			if err := st.Pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM object_deletion_queue WHERE storage_key=$1)`, key).Scan(&queued); err != nil {
				t.Fatal(err)
			}
			if !queued {
				t.Fatal("rejected image not queued for cleanup")
			}
		})
	}
}

func TestAvatarReviewWaitsForOwnerBeforeLockingReview(t *testing.T) {
	ts, st := newTestServer(t)
	admin := registerUser(t, ts, "lock-admin@test.local", "Moderator")
	bootstrapAdmin(t, st, admin.User.ID)
	owner := registerUser(t, ts, "lock-owner@test.local", "Player")
	resp := doJSON(t, ts, http.MethodPost, "/me/avatar", owner.AccessToken, nil)
	upload := decodeJSON[struct {
		AvatarURL string `json:"avatar_url"`
	}](t, resp)
	key := strings.TrimPrefix(upload.AvatarURL, "/photos/")
	resp = doJSON(t, ts, http.MethodPatch, "/me", owner.AccessToken, map[string]string{"avatar_url": upload.AvatarURL})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("submit avatar: %d %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := st.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	// Hold the same first lock as avatar clearing/replacement.
	if _, err := tx.Exec(ctx, `SELECT id FROM users WHERE id=$1 FOR UPDATE`, owner.User.ID); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/api/v1/admin/media/review", strings.NewReader(fmt.Sprintf(`{"key":%q,"approve":true}`, key)))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+admin.AccessToken)
	request.Header.Set("Content-Type", "application/json")
	type result struct {
		response *http.Response
		err      error
	}
	done := make(chan result, 1)
	go func() { response, err := ts.Client().Do(request); done <- result{response, err} }()
	// Wait for the actual database lock wait, not an assumed request timing.
	for {
		var waiting bool
		if err := st.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)))`, int32(tx.Conn().PgConn().PID())).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("review never waited for owner lock")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if _, err := tx.Exec(ctx, `SET LOCAL lock_timeout='1s'`); err != nil {
		t.Fatal(err)
	}
	// This would deadlock if the reviewer already held the media_reviews lock.
	if _, err := tx.Exec(ctx, `DELETE FROM media_reviews WHERE storage_key=$1`, key); err != nil {
		t.Fatalf("clear pending avatar while review waits: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	got := <-done
	if got.err != nil {
		t.Fatal(got.err)
	}
	defer got.response.Body.Close()
	if got.response.StatusCode != http.StatusNotFound {
		t.Fatalf("canceled review: %d, want 404", got.response.StatusCode)
	}
	var avatar *string
	if err := st.Pool.QueryRow(ctx, `SELECT avatar_url FROM users WHERE id=$1`, owner.User.ID).Scan(&avatar); err != nil {
		t.Fatal(err)
	}
	if avatar != nil {
		t.Fatal("canceled avatar was published")
	}
}
