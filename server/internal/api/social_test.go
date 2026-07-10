package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestGetProfilePublic(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "profile@test.local", "Profile Player")

	// Public read, no bearer.
	resp := doJSON(t, ts, http.MethodGet, "/users/"+u.User.ID, "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get profile: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	body := decodeJSON[struct {
		ID            string `json:"id"`
		DisplayName   string `json:"display_name"`
		CheckInCount  int    `json:"check_in_count"`
		FollowerCount int    `json:"follower_count"`
		StreakDays    int    `json:"streak_days"`
		IsFollowing   bool   `json:"is_following"`
	}](t, resp)
	if body.DisplayName != "Profile Player" || body.CheckInCount != 0 || body.FollowerCount != 0 {
		t.Errorf("unexpected profile: %+v", body)
	}

	// Unknown user → 404.
	resp = doJSON(t, ts, http.MethodGet, "/users/00000000-0000-0000-0000-000000000000", "", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown user: status %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestFollowFlow(t *testing.T) {
	ts, _ := newTestServer(t)
	a := registerUser(t, ts, "a@test.local", "A")
	b := registerUser(t, ts, "b@test.local", "B")

	// Self-follow → 400.
	resp := doJSON(t, ts, http.MethodPut, "/users/"+a.User.ID+"/follow", a.AccessToken, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("self-follow: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// Follow b.
	resp = doJSON(t, ts, http.MethodPut, "/users/"+b.User.ID+"/follow", a.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("follow: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	// b's profile shows follower_count 1, follows_you true for a.
	resp = doJSON(t, ts, http.MethodGet, "/users/"+b.User.ID, a.AccessToken, nil)
	p := decodeJSON[struct {
		FollowerCount int  `json:"follower_count"`
		IsFollowing   bool `json:"is_following"`
	}](t, resp)
	if p.FollowerCount != 1 || !p.IsFollowing {
		t.Errorf("after follow: %+v", p)
	}

	// Unfollow is idempotent.
	for i := 0; i < 2; i++ {
		resp = doJSON(t, ts, http.MethodDelete, "/users/"+b.User.ID+"/follow", a.AccessToken, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("unfollow %d: status %d", i, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

func TestFollowBlockedRejected(t *testing.T) {
	ts, _ := newTestServer(t)
	a := registerUser(t, ts, "ab@test.local", "A")
	b := registerUser(t, ts, "bb@test.local", "B")

	// a follows b, then b blocks a → edge severed and re-follow rejected.
	doJSON(t, ts, http.MethodPut, "/users/"+b.User.ID+"/follow", a.AccessToken, nil).Body.Close()
	doJSON(t, ts, http.MethodPut, "/users/"+a.User.ID+"/block", b.AccessToken, nil).Body.Close()

	resp := doJSON(t, ts, http.MethodGet, "/users/"+b.User.ID, "", nil)
	if p := decodeJSON[struct {
		FollowerCount int `json:"follower_count"`
	}](t, resp); p.FollowerCount != 0 {
		t.Errorf("block did not sever follow: follower_count %d", p.FollowerCount)
	}
	resp = doJSON(t, ts, http.MethodPut, "/users/"+b.User.ID+"/follow", a.AccessToken, nil)
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("follow while blocked: status %d, want 409", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestAvatarUploadAndClear(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "avatar@test.local", "Avatar")

	resp := doJSON(t, ts, http.MethodPost, "/me/avatar", u.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create avatar upload: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	body := decodeJSON[struct {
		AvatarURL  string `json:"avatar_url"`
		UploadPath string `json:"upload_path"`
	}](t, resp)
	if !strings.HasPrefix(body.AvatarURL, "/photos/avatars/") {
		t.Errorf("avatar_url = %q, want /photos/avatars/ prefix", body.AvatarURL)
	}
	if !strings.Contains(body.UploadPath, "avatars/") || !strings.Contains(body.UploadPath, "sig=") {
		t.Errorf("upload_path missing avatars key or signature: %q", body.UploadPath)
	}

	// PATCH sets it, DELETE clears it.
	doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"avatar_url": body.AvatarURL}).Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/users/"+u.User.ID, "", nil)
	if p := decodeJSON[struct {
		AvatarURL *string `json:"avatar_url"`
	}](t, resp); p.AvatarURL == nil || *p.AvatarURL != body.AvatarURL {
		t.Errorf("avatar not set after PATCH")
	}
	doJSON(t, ts, http.MethodDelete, "/me/avatar", u.AccessToken, nil).Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/users/"+u.User.ID, "", nil)
	if p := decodeJSON[struct {
		AvatarURL *string `json:"avatar_url"`
	}](t, resp); p.AvatarURL != nil {
		t.Errorf("avatar not cleared after DELETE")
	}
}

// TestAdminClearAvatar regression-tests the admin_actions CHECK constraint:
// handleAdminClearAvatar writes an audit row with action='clear_avatar',
// which the original migration's CHECK (action IN ('promote','demote'))
// rejected. The handler only logs that error (established pattern), so the
// endpoint still returned 204 while the audit row silently never landed.
// This asserts the row actually exists, which fails against the
// pre-00009_admin_action_clear_avatar.sql constraint even though the HTTP
// response looks fine.
func TestAdminClearAvatar(t *testing.T) {
	ts, st := newTestServer(t)
	admin := registerUser(t, ts, "clearavataradmin@test.local", "ClearAvatarAdmin")
	bootstrapAdmin(t, st, admin.User.ID)
	target := registerUser(t, ts, "clearavatartarget@test.local", "ClearAvatarTarget")

	// Give the target an avatar to clear.
	doJSON(t, ts, http.MethodPatch, "/me", target.AccessToken, map[string]any{
		"avatar_url": "/photos/avatars/seed.jpg",
	}).Body.Close()
	resp := doJSON(t, ts, http.MethodGet, "/users/"+target.User.ID, "", nil)
	if p := decodeJSON[struct {
		AvatarURL *string `json:"avatar_url"`
	}](t, resp); p.AvatarURL == nil {
		t.Fatalf("avatar not set on target before admin clear")
	}

	// Admin clears it.
	resp = doJSON(t, ts, http.MethodPost, "/admin/users/"+target.User.ID+"/avatar/clear", admin.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("admin clear avatar: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/users/"+target.User.ID, "", nil)
	if p := decodeJSON[struct {
		AvatarURL *string `json:"avatar_url"`
	}](t, resp); p.AvatarURL != nil {
		t.Errorf("avatar not cleared after admin clear: %v", *p.AvatarURL)
	}

	// The audit row is the actual point of this test: it must exist, which
	// requires the admin_actions CHECK constraint to permit 'clear_avatar'.
	targetID, err := uuid.Parse(target.User.ID)
	if err != nil {
		t.Fatalf("parse target id: %v", err)
	}
	var count int
	if err := st.Pool.QueryRow(context.Background(),
		"SELECT count(*) FROM admin_actions WHERE action='clear_avatar' AND target_user_id=$1",
		targetID,
	).Scan(&count); err != nil {
		t.Fatalf("query admin_actions: %v", err)
	}
	if count != 1 {
		t.Errorf("admin_actions rows with action=clear_avatar for target = %d, want 1", count)
	}
}
