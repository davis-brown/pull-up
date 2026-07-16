package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// mustUUID parses s as a UUID or fails the test.
func mustUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return id
}

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
		AvatarURL           string `json:"avatar_url"`
		UploadPath          string `json:"upload_path"`
		UploadAuthorization string `json:"upload_authorization"`
	}](t, resp)
	if !strings.HasPrefix(body.AvatarURL, "/photos/avatars/") {
		t.Errorf("avatar_url = %q, want /photos/avatars/ prefix", body.AvatarURL)
	}
	if !strings.Contains(body.UploadPath, "avatars/") || strings.Contains(body.UploadPath, "?") ||
		!strings.HasPrefix(body.UploadAuthorization, "PullUp-Upload ") {
		t.Errorf("avatar upload contract invalid: path=%q authorization=%q",
			body.UploadPath, body.UploadAuthorization)
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
		"avatar_url": "/photos/avatars/" + target.User.ID + "/seed.jpg",
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

func TestFollowerGetsRunNotification(t *testing.T) {
	ts, st := newTestServer(t)
	planner := registerUser(t, ts, "planner@test.local", "Planner")
	follower := registerUser(t, ts, "follower2@test.local", "Follower")

	// follower follows planner and registers a push token; is NOT a favoriter.
	doJSON(t, ts, http.MethodPut, "/users/"+planner.User.ID+"/follow", follower.AccessToken, nil).Body.Close()
	doJSON(t, ts, http.MethodPost, "/me/push-token", follower.AccessToken, map[string]any{"token": "ExpoTok[follower]"}).Body.Close()

	court := createTestCourt(t, ts, planner.AccessToken, "Notify Court", ruckerLat, ruckerLng)

	// Query the notify set directly (deterministic; avoids asserting on the
	// real push transport).
	toks, err := st.Queries.ListSessionNotifyTokens(context.Background(), gen.ListSessionNotifyTokensParams{
		Actor: mustUUID(t, planner.User.ID), CourtID: mustUUID(t, court.ID),
	})
	if err != nil {
		t.Fatalf("notify tokens: %v", err)
	}
	if len(toks) != 1 || toks[0] != "ExpoTok[follower]" {
		t.Errorf("notify tokens = %v, want [ExpoTok[follower]]", toks)
	}
}

// playerCard mirrors the /me response fields added for player cards.
type playerCard struct {
	JerseyNumber *int     `json:"jersey_number"`
	Position     *string  `json:"position"`
	HeightCm     *int     `json:"height_cm"`
	StyleTags    []string `json:"style_tags"`
}

func TestPatchMePlayerCard(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "playercard@test.local", "Player Card")

	// Valid partial update sets all four fields and echoes them back.
	resp := doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{
		"jersey_number": 23, "position": "guard", "height_cm": 185, "style_tags": []string{"shooter", "casual"},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid patch: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	card := decodeJSON[playerCard](t, resp)
	if card.JerseyNumber == nil || *card.JerseyNumber != 23 {
		t.Errorf("jersey_number = %v, want 23", card.JerseyNumber)
	}
	if card.Position == nil || *card.Position != "guard" {
		t.Errorf("position = %v, want guard", card.Position)
	}
	if card.HeightCm == nil || *card.HeightCm != 185 {
		t.Errorf("height_cm = %v, want 185", card.HeightCm)
	}
	if len(card.StyleTags) != 2 || card.StyleTags[0] != "shooter" || card.StyleTags[1] != "casual" {
		t.Errorf("style_tags = %v, want [shooter casual]", card.StyleTags)
	}

	// GET /me reflects the same values.
	resp = doJSON(t, ts, http.MethodGet, "/me", u.AccessToken, nil)
	if got := decodeJSON[playerCard](t, resp); got.JerseyNumber == nil || *got.JerseyNumber != 23 {
		t.Errorf("GET /me jersey_number = %v, want 23", got.JerseyNumber)
	}

	// A partial update touching only one field doesn't clobber the others.
	doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"height_cm": 190}).Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/me", u.AccessToken, nil)
	card = decodeJSON[playerCard](t, resp)
	if card.HeightCm == nil || *card.HeightCm != 190 {
		t.Errorf("height_cm after partial update = %v, want 190", card.HeightCm)
	}
	if card.JerseyNumber == nil || *card.JerseyNumber != 23 {
		t.Errorf("jersey_number clobbered by unrelated patch: %v", card.JerseyNumber)
	}
	if card.Position == nil || *card.Position != "guard" {
		t.Errorf("position clobbered by unrelated patch: %v", card.Position)
	}
	if len(card.StyleTags) != 2 {
		t.Errorf("style_tags clobbered by unrelated patch: %v", card.StyleTags)
	}

	// Invalid position.
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"position": "pivot"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("invalid position: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// Jersey number out of range.
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"jersey_number": 100})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("jersey_number 100: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"jersey_number": -1})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("jersey_number -1: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// Height out of range.
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"height_cm": 119})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("height_cm 119: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"height_cm": 251})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("height_cm 251: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// More than 3 style tags.
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{
		"style_tags": []string{"shooter", "casual", "defense", "rim_runner"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("4 style_tags: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// Unknown style tag.
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"style_tags": []string{"dunker"}})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("unknown style tag: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// The rejected patches above must not have clobbered the valid state.
	resp = doJSON(t, ts, http.MethodGet, "/me", u.AccessToken, nil)
	card = decodeJSON[playerCard](t, resp)
	if card.JerseyNumber == nil || *card.JerseyNumber != 23 {
		t.Errorf("jersey_number after rejected patches = %v, want 23", card.JerseyNumber)
	}
	if len(card.StyleTags) != 2 {
		t.Errorf("style_tags after rejected patches = %v, want len 2", card.StyleTags)
	}

	// Explicit null clears nullable player-card fields; omission remains a
	// no-op, which cannot be represented with ordinary pointer decoding.
	resp = doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{
		"jersey_number": nil, "position": nil, "height_cm": nil,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clear nullable fields: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	card = decodeJSON[playerCard](t, resp)
	if card.JerseyNumber != nil || card.Position != nil || card.HeightCm != nil {
		t.Fatalf("explicit null did not clear player fields: %+v", card)
	}
	if len(card.StyleTags) != 2 {
		t.Errorf("nullable clear clobbered omitted style_tags: %v", card.StyleTags)
	}
}

func TestSetPrivateFlag(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "private@test.local", "Private User")

	// Default public.
	resp := doJSON(t, ts, http.MethodGet, "/me", u.AccessToken, nil)
	if me := decodeJSON[struct {
		IsPrivate bool `json:"is_private"`
	}](t, resp); me.IsPrivate {
		t.Fatalf("new account should be public")
	}

	// Toggle private.
	doJSON(t, ts, http.MethodPatch, "/me", u.AccessToken, map[string]any{"is_private": true}).Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/me", u.AccessToken, nil)
	if me := decodeJSON[struct {
		IsPrivate bool `json:"is_private"`
	}](t, resp); !me.IsPrivate {
		t.Errorf("is_private did not persist")
	}
}

func TestFollowPrivateAccountRequests(t *testing.T) {
	ts, _ := newTestServer(t)
	a := registerUser(t, ts, "reqa@test.local", "A")
	b := registerUser(t, ts, "reqb@test.local", "B")
	// B goes private.
	doJSON(t, ts, http.MethodPatch, "/me", b.AccessToken, map[string]any{"is_private": true}).Body.Close()

	// A follows B → request, not a follow.
	resp := doJSON(t, ts, http.MethodPut, "/users/"+b.User.ID+"/follow", a.AccessToken, nil)
	if body := decodeJSON[struct {
		Requested bool `json:"requested"`
	}](t, resp); !body.Requested {
		t.Fatalf("private follow should return requested:true")
	}
	// B's follower count is still 0 (pending is not a follow).
	resp = doJSON(t, ts, http.MethodGet, "/users/"+b.User.ID, a.AccessToken, nil)
	if p := decodeJSON[struct {
		FollowerCount int  `json:"follower_count"`
		HasRequested  bool `json:"has_requested"`
	}](t, resp); p.FollowerCount != 0 || !p.HasRequested {
		t.Errorf("after request: %+v, want count 0 + has_requested", p)
	}

	// B sees the incoming request and accepts it.
	resp = doJSON(t, ts, http.MethodGet, "/me/follow-requests", b.AccessToken, nil)
	if reqs := decodeJSON[struct {
		Requests []struct {
			ID string `json:"id"`
		} `json:"requests"`
	}](t, resp); len(reqs.Requests) != 1 || reqs.Requests[0].ID != a.User.ID {
		t.Fatalf("B's incoming requests wrong: %+v", reqs)
	}
	resp = doJSON(t, ts, http.MethodPost, "/users/"+a.User.ID+"/follow-requests/accept", b.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("accept: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Now A is an accepted follower.
	resp = doJSON(t, ts, http.MethodGet, "/users/"+b.User.ID, a.AccessToken, nil)
	if p := decodeJSON[struct {
		FollowerCount int  `json:"follower_count"`
		IsFollowing   bool `json:"is_following"`
	}](t, resp); p.FollowerCount != 1 || !p.IsFollowing {
		t.Errorf("after accept: %+v, want count 1 + is_following", p)
	}
}

func TestPrivateProfileHidesActivity(t *testing.T) {
	ts, _ := newTestServer(t)
	owner := registerUser(t, ts, "powner@test.local", "Owner")
	viewer := registerUser(t, ts, "pviewer@test.local", "Viewer")
	doJSON(t, ts, http.MethodPatch, "/me", owner.AccessToken, map[string]any{"is_private": true}).Body.Close()

	// Non-follower sees limited profile: is_private true, activity zeroed, list 403.
	resp := doJSON(t, ts, http.MethodGet, "/users/"+owner.User.ID, viewer.AccessToken, nil)
	p := decodeJSON[struct {
		IsPrivate    bool `json:"is_private"`
		CheckInCount int  `json:"check_in_count"`
		StreakDays   int  `json:"streak_days"`
	}](t, resp)
	if !p.IsPrivate || p.CheckInCount != 0 || p.StreakDays != 0 {
		t.Errorf("private profile not gated for non-follower: %+v", p)
	}
	resp = doJSON(t, ts, http.MethodGet, "/users/"+owner.User.ID+"/followers", viewer.AccessToken, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("followers list for private account: status %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// Owner sees their own full profile (not gated).
	resp = doJSON(t, ts, http.MethodGet, "/users/"+owner.User.ID, owner.AccessToken, nil)
	if p := decodeJSON[struct {
		IsPrivate bool `json:"is_private"`
	}](t, resp); !p.IsPrivate {
		t.Errorf("owner should still see is_private true on self")
	}
}

func TestBlockClearsPendingRequest(t *testing.T) {
	ts, _ := newTestServer(t)
	a := registerUser(t, ts, "bpa@test.local", "A")
	b := registerUser(t, ts, "bpb@test.local", "B")
	doJSON(t, ts, http.MethodPatch, "/me", b.AccessToken, map[string]any{"is_private": true}).Body.Close()
	doJSON(t, ts, http.MethodPut, "/users/"+b.User.ID+"/follow", a.AccessToken, nil).Body.Close() // request
	// B blocks A → request cleared.
	doJSON(t, ts, http.MethodPut, "/users/"+a.User.ID+"/block", b.AccessToken, nil).Body.Close()
	resp := doJSON(t, ts, http.MethodGet, "/me/follow-requests", b.AccessToken, nil)
	if reqs := decodeJSON[struct {
		Requests []map[string]any `json:"requests"`
	}](t, resp); len(reqs.Requests) != 0 {
		t.Errorf("block did not clear pending request: %+v", reqs)
	}
}
