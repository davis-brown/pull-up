package api_test

import (
	"net/http"
	"strings"
	"testing"
)

func TestInternalDrainRequiresSecret(t *testing.T) {
	ts, _ := newTestServer(t)
	resp := doJSON(t, ts, http.MethodPost, "/internal/drain", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no-secret drain: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestInternalMediaAuthorizationAndDeletionQueue(t *testing.T) {
	ts, st := newTestServer(t)
	owner := registerUser(t, ts, "media-owner@test.local", "Media Owner")
	admin := registerUser(t, ts, "media-admin@test.local", "Media Admin")
	bootstrapAdmin(t, st, admin.User.ID)
	court := createTestCourt(t, ts, owner.AccessToken, "Media Court", ruckerLat, ruckerLng)

	internalPost := func(path string, body any) *http.Response {
		return doJSONHeaders(t, ts, http.MethodPost, path, "", body,
			map[string]string{"X-Internal-Task": "test-internal-secret"})
	}
	claim := func() []string {
		resp := internalPost("/internal/media/deletions/claim", map[string]int{"limit": 100})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("claim deletions: status %d", resp.StatusCode)
		}
		return decodeJSON[struct {
			Keys []string `json:"keys"`
		}](t, resp).Keys
	}
	ack := func(keys []string) {
		resp := internalPost("/internal/media/deletions/ack", map[string]any{"keys": keys})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("ack deletions: status %d", resp.StatusCode)
		}
		resp.Body.Close()
	}
	contains := func(keys []string, want string) bool {
		for _, key := range keys {
			if key == want {
				return true
			}
		}
		return false
	}

	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/photos", owner.AccessToken, map[string]any{})
	photo := decodeJSON[struct {
		Photo struct {
			ID         string `json:"id"`
			StorageKey string `json:"storage_key"`
		} `json:"photo"`
	}](t, resp).Photo
	resp = doJSON(t, ts, http.MethodPost, "/internal/media/authorize", "", map[string]string{"key": photo.StorageKey})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("media authorize without secret: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
	resp = internalPost("/internal/media/authorize", map[string]string{"key": photo.StorageKey})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("authorize pending photo: status %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
	resp = internalPost("/internal/media/uploaded", map[string]string{"key": photo.StorageKey})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("finalize photo: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = internalPost("/internal/media/authorize", map[string]string{"key": photo.StorageKey})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("authorize visible photo: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/admin/photos/"+photo.ID+"/status", admin.AccessToken,
		map[string]string{"status": "removed"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("remove photo: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = internalPost("/internal/media/authorize", map[string]string{"key": photo.StorageKey})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("authorize removed photo: status %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
	keys := claim()
	if !contains(keys, photo.StorageKey) {
		t.Fatalf("moderated photo key not queued: %v", keys)
	}
	ack(keys)

	createAvatar := func() (string, string) {
		resp := doJSON(t, ts, http.MethodPost, "/me/avatar", owner.AccessToken, nil)
		body := decodeJSON[struct {
			AvatarURL string `json:"avatar_url"`
		}](t, resp)
		return body.AvatarURL, strings.TrimPrefix(body.AvatarURL, "/photos/")
	}
	avatar1, key1 := createAvatar()
	doJSON(t, ts, http.MethodPatch, "/me", owner.AccessToken, map[string]any{"avatar_url": avatar1}).Body.Close()
	avatar2, key2 := createAvatar()
	doJSON(t, ts, http.MethodPatch, "/me", owner.AccessToken, map[string]any{"avatar_url": avatar2}).Body.Close()
	keys = claim()
	if !contains(keys, key1) {
		t.Fatalf("replaced avatar key not queued: %v", keys)
	}
	ack(keys)
	doJSON(t, ts, http.MethodDelete, "/me/avatar", owner.AccessToken, nil).Body.Close()
	keys = claim()
	if !contains(keys, key2) {
		t.Fatalf("cleared avatar key not queued: %v", keys)
	}
	ack(keys)

	// Deleting an account cascades its owned photo metadata and current avatar;
	// both objects are queued while the community court survives detached.
	avatar3, key3 := createAvatar()
	doJSON(t, ts, http.MethodPatch, "/me", owner.AccessToken, map[string]any{"avatar_url": avatar3}).Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/photos", owner.AccessToken, map[string]any{})
	photo2 := decodeJSON[struct {
		Photo struct {
			StorageKey string `json:"storage_key"`
		} `json:"photo"`
	}](t, resp).Photo
	resp = doJSON(t, ts, http.MethodDelete, "/me", owner.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete media owner: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	keys = claim()
	if !contains(keys, key3) || !contains(keys, photo2.StorageKey) {
		t.Fatalf("account-owned media not fully queued: %v", keys)
	}
	ack(keys)
}

// TestAvatarFinalizeBeforePatchStillClaims covers the real upload order:
// pending upload, Worker calls /internal/media/uploaded, then the client
// PATCHes /me. Regression test for finalize deleting the pending_uploads row
// prematurely, which made every avatar PATCH 400.
func TestAvatarFinalizeBeforePatchStillClaims(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "avatar-finalize@test.local", "Avatar Finalize")

	resp := doJSON(t, ts, http.MethodPost, "/me/avatar", u.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create avatar upload: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	body := decodeJSON[struct {
		AvatarURL string `json:"avatar_url"`
	}](t, resp)
	key := strings.TrimPrefix(body.AvatarURL, "/photos/")

	// The Worker finalizes the object as soon as the upload PUT succeeds, before
	// the client's PATCH /me arrives.
	resp = doJSONHeaders(t, ts, http.MethodPost, "/internal/media/uploaded", "",
		map[string]string{"key": key}, map[string]string{"X-Internal-Task": "test-internal-secret"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("finalize avatar: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	// The pending row must still exist so PATCH can claim it.
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"avatar_url": body.AvatarURL})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch avatar after finalize: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/users/"+u.User.ID, "", nil)
	if p := decodeJSON[struct {
		AvatarURL *string `json:"avatar_url"`
	}](t, resp); p.AvatarURL == nil || *p.AvatarURL != body.AvatarURL {
		t.Errorf("avatar not set after finalize+patch")
	}
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
