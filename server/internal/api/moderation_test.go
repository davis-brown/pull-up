package api_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/davisbrown/pull-up/server/internal/store"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// bootstrapAdmin promotes a user the same way an operator would for the
// very first admin: directly against the store, out-of-band of the API.
func bootstrapAdmin(t *testing.T, st *store.Store, userID string) {
	t.Helper()
	id, err := uuid.Parse(userID)
	if err != nil {
		t.Fatalf("parse user id: %v", err)
	}
	if _, err := st.Queries.SetUserAdmin(context.Background(), gen.SetUserAdminParams{ID: id, IsAdmin: true}); err != nil {
		t.Fatalf("bootstrap admin: %v", err)
	}
}

func TestCreateFlagValidation(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "flagger@test.local", "Flagger")
	court := createTestCourt(t, ts, u.AccessToken, "Flaggable Court", ruckerLat, ruckerLng)

	resp := doJSON(t, ts, http.MethodPost, "/flags", u.AccessToken, map[string]any{
		"entity_type": "vehicle", "entity_id": court.ID, "reason": "not a real type",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad entity_type: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/flags", u.AccessToken, map[string]any{
		"entity_type": "court", "entity_id": court.ID, "reason": "",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty reason: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/flags", u.AccessToken, map[string]any{
		"entity_type": "court", "entity_id": court.ID, "reason": "Wrong location",
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("valid flag: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	// App feedback needs no meaningful target: the server records it against
	// the reporting user regardless of the entity_id sent.
	resp = doJSON(t, ts, http.MethodPost, "/flags", u.AccessToken, map[string]any{
		"entity_type": "feedback", "entity_id": u.User.ID, "reason": "Map jumps when I check in",
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("feedback flag: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
}

func TestAdminRoutesForbiddenForRegularUsers(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "civilian@test.local", "Civilian")

	for _, req := range []struct {
		method, path string
	}{
		{http.MethodGet, "/admin/flags"},
		{http.MethodGet, "/admin/users?q=a"},
		{http.MethodGet, "/admin/actions"},
	} {
		resp := doJSON(t, ts, req.method, req.path, u.AccessToken, nil)
		if resp.StatusCode != http.StatusForbidden {
			t.Errorf("%s %s as non-admin: status %d, want 403", req.method, req.path, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

func TestAdminFlagAndModerationFlow(t *testing.T) {
	ts, st := newTestServer(t)
	admin := registerUser(t, ts, "modadmin@test.local", "ModAdmin")
	bootstrapAdmin(t, st, admin.User.ID)
	reporter := registerUser(t, ts, "modreporter@test.local", "ModReporter")

	court := createTestCourt(t, ts, reporter.AccessToken, "Under Review Court", ruckerLat, ruckerLng)
	resp := doJSON(t, ts, http.MethodPost, "/flags", reporter.AccessToken, map[string]any{
		"entity_type": "court", "entity_id": court.ID, "reason": "Doesn't exist",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create flag: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/admin/flags", admin.AccessToken, nil)
	flags := decodeJSON[struct {
		Flags []struct {
			ID         string `json:"id"`
			EntityType string `json:"entity_type"`
			EntityID   string `json:"entity_id"`
		} `json:"flags"`
	}](t, resp)
	if len(flags.Flags) != 1 || flags.Flags[0].EntityID != court.ID {
		t.Fatalf("open flags = %+v, want just the court flag", flags.Flags)
	}
	flagID := flags.Flags[0].ID

	resp = doJSON(t, ts, http.MethodPost, "/admin/courts/"+court.ID+"/status", admin.AccessToken, map[string]string{
		"status": "rejected",
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("set court status: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID, "", nil)
	got := decodeJSON[courtResp](t, resp)
	if got.Status != "rejected" {
		t.Errorf("court status = %q, want rejected", got.Status)
	}

	resp = doJSON(t, ts, http.MethodPost, "/admin/courts/"+court.ID+"/status", admin.AccessToken, map[string]string{
		"status": "banned",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid court status: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/admin/flags/"+flagID+"/resolve", admin.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("resolve flag: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/admin/flags", admin.AccessToken, nil)
	flags = decodeJSON[struct {
		Flags []struct {
			ID         string `json:"id"`
			EntityType string `json:"entity_type"`
			EntityID   string `json:"entity_id"`
		} `json:"flags"`
	}](t, resp)
	if len(flags.Flags) != 0 {
		t.Fatalf("flags after resolve = %+v, want none", flags.Flags)
	}

	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/photos", reporter.AccessToken, map[string]any{})
	photo := decodeJSON[struct {
		Photo struct {
			ID string `json:"id"`
		} `json:"photo"`
	}](t, resp)

	resp = doJSON(t, ts, http.MethodPost, "/admin/photos/"+photo.Photo.ID+"/status", admin.AccessToken, map[string]string{
		"status": "removed",
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("set photo status: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/photos", "", nil)
	photos := decodeJSON[struct {
		Photos []map[string]any `json:"photos"`
	}](t, resp)
	if len(photos.Photos) != 0 {
		t.Fatalf("removed photo still listed: %+v", photos.Photos)
	}
}

// External photos are inserted only by the enricher (which hits live
// services), so this seeds one through the store and exercises the admin
// hide → excluded-from-listing path directly.
func TestAdminHideExternalPhoto(t *testing.T) {
	ts, st := newTestServer(t)
	admin := registerUser(t, ts, "extadmin@test.local", "ExtAdmin")
	bootstrapAdmin(t, st, admin.User.ID)
	owner := registerUser(t, ts, "extowner@test.local", "ExtOwner")

	court := createTestCourt(t, ts, owner.AccessToken, "Photo Court", ruckerLat, ruckerLng)
	courtID, err := uuid.Parse(court.ID)
	if err != nil {
		t.Fatalf("parse court id: %v", err)
	}
	const sourceID = "778899"
	if err := st.Queries.InsertExternalPhoto(t.Context(), gen.InsertExternalPhotoParams{
		CourtID:  courtID,
		Source:   "mapillary",
		SourceID: sourceID,
		ImageUrl: "https://example.test/ext-1.jpg",
		PageUrl:  "https://example.test/ext-1",
	}); err != nil {
		t.Fatalf("seed external photo: %v", err)
	}

	extIDs := func() []string {
		resp := doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/photos", "", nil)
		body := decodeJSON[struct {
			External []struct {
				ID string `json:"id"`
			} `json:"external"`
		}](t, resp)
		ids := make([]string, len(body.External))
		for i, e := range body.External {
			ids[i] = e.ID
		}
		return ids
	}

	ids := extIDs()
	if len(ids) != 1 {
		t.Fatalf("external photos before hide = %v, want one", ids)
	}
	photoID := ids[0]

	resp := doJSON(t, ts, http.MethodPost, "/admin/external-photos/"+photoID+"/status", owner.AccessToken, map[string]string{
		"status": "hidden",
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-admin hide: status %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/admin/external-photos/"+photoID+"/status", admin.AccessToken, map[string]string{
		"status": "removed",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid status: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/admin/external-photos/"+photoID+"/status", admin.AccessToken, map[string]string{
		"status": "hidden",
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("hide external photo: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	if ids := extIDs(); len(ids) != 0 {
		t.Fatalf("hidden external photo still listed: %v", ids)
	}

	// Hiding enqueues the cached R2 object for deletion so its bytes are
	// reclaimed on the next cron drain.
	keys, err := st.Queries.ClaimObjectDeletions(t.Context(), 10)
	if err != nil {
		t.Fatalf("claim object deletions: %v", err)
	}
	wantKey := "ext/mapillary/" + sourceID
	found := false
	for _, k := range keys {
		if k == wantKey {
			found = true
		}
	}
	if !found {
		t.Fatalf("deletion queue = %v, want to contain %q", keys, wantKey)
	}

	resp = doJSON(t, ts, http.MethodPost, "/admin/external-photos/"+uuid.NewString()+"/status", admin.AccessToken, map[string]string{
		"status": "hidden",
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown external photo: status %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
}

// The Worker's read-through R2 cache resolves a visible external photo's
// upstream URL through this secret-guarded internal endpoint, and a hidden
// photo must stop resolving so moderation takes effect on the next read.
func TestInternalResolveExternalPhoto(t *testing.T) {
	ts, st := newTestServer(t)
	owner := registerUser(t, ts, "resolveowner@test.local", "ResolveOwner")
	admin := registerUser(t, ts, "resolveadmin@test.local", "ResolveAdmin")
	bootstrapAdmin(t, st, admin.User.ID)

	court := createTestCourt(t, ts, owner.AccessToken, "Resolve Court", ruckerLat, ruckerLng)
	courtID, err := uuid.Parse(court.ID)
	if err != nil {
		t.Fatalf("parse court id: %v", err)
	}
	const sourceID = "1234567890"
	if err := st.Queries.InsertExternalPhoto(t.Context(), gen.InsertExternalPhotoParams{
		CourtID:  courtID,
		Source:   "mapillary",
		SourceID: sourceID,
		ImageUrl: "https://images.mapillary.test/1234567890.jpg",
		PageUrl:  "https://www.mapillary.com/app/?pKey=1234567890",
	}); err != nil {
		t.Fatalf("seed external photo: %v", err)
	}

	secret := map[string]string{"X-Internal-Task": "test-internal-secret"}
	resolve := func(source, id string) *http.Response {
		return doJSONHeaders(t, ts, http.MethodPost, "/internal/external-photo/resolve", "",
			map[string]string{"source": source, "source_id": id}, secret)
	}

	resp := resolve("mapillary", sourceID)
	got := decodeJSON[struct {
		ImageURL string `json:"image_url"`
	}](t, resp)
	if got.ImageURL != "https://images.mapillary.test/1234567890.jpg" {
		t.Fatalf("resolved image_url = %q, want the seeded URL", got.ImageURL)
	}

	// Without the internal secret the endpoint is not reachable. The Worker
	// 404s public /internal/ requests before they ever reach the container.
	resp = doJSON(t, ts, http.MethodPost, "/internal/external-photo/resolve", "",
		map[string]string{"source": "mapillary", "source_id": sourceID})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("resolve without secret: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()

	for _, bad := range []struct{ source, id string }{
		{"flickr", sourceID}, {"mapillary", "not-a-number"}, {"mapillary", ""},
	} {
		resp = resolve(bad.source, bad.id)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("resolve %+v: status %d, want 400", bad, resp.StatusCode)
		}
		resp.Body.Close()
	}

	resp = resolve("commons", "999")
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("resolve unknown: status %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()

	// Hide it, then it must stop resolving — the read-through cache will 404
	// even though it may already hold the bytes.
	photoID := ""
	{
		resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/photos", "", nil)
		body := decodeJSON[struct {
			External []struct {
				ID string `json:"id"`
			} `json:"external"`
		}](t, resp)
		if len(body.External) != 1 {
			t.Fatalf("external photos = %d, want one", len(body.External))
		}
		photoID = body.External[0].ID
	}
	resp = doJSON(t, ts, http.MethodPost, "/admin/external-photos/"+photoID+"/status", admin.AccessToken,
		map[string]string{"status": "hidden"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("hide external photo: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = resolve("mapillary", sourceID)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("resolve after hide: status %d, want 404", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestAdminPromoteDemoteAndLastAdminGuard(t *testing.T) {
	ts, st := newTestServer(t)
	first := registerUser(t, ts, "firstadmin@test.local", "FirstAdmin")
	bootstrapAdmin(t, st, first.User.ID)
	regular := registerUser(t, ts, "promotable@test.local", "Promotable Pat")

	resp := doJSON(t, ts, http.MethodGet, "/admin/users?q=Promotable", first.AccessToken, nil)
	found := decodeJSON[struct {
		Users []struct {
			ID      string `json:"id"`
			IsAdmin bool   `json:"is_admin"`
		} `json:"users"`
	}](t, resp)
	if len(found.Users) != 1 || found.Users[0].ID != regular.User.ID || found.Users[0].IsAdmin {
		t.Fatalf("search result = %+v, want one non-admin match", found.Users)
	}

	resp = doJSON(t, ts, http.MethodPost, "/admin/users/"+regular.User.ID+"/admin", first.AccessToken, map[string]bool{
		"is_admin": true,
	})
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("promote: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	// A freshly promoted admin can use admin routes (their token was
	// issued before promotion, but authorization is checked live per
	// request against the DB, not baked into the JWT).
	resp = doJSON(t, ts, http.MethodGet, "/admin/flags", regular.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("promoted user hitting admin route: status %d, want 200", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/admin/users/"+first.User.ID+"/admin", regular.AccessToken, map[string]bool{
		"is_admin": false,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("demote first admin (not last): status %d", resp.StatusCode)
	}
	resp.Body.Close()

	// Now there's exactly one admin left; demoting them must be rejected
	// so nobody can lock the account out of moderation entirely.
	resp = doJSON(t, ts, http.MethodPost, "/admin/users/"+regular.User.ID+"/admin", regular.AccessToken, map[string]bool{
		"is_admin": false,
	})
	if resp.StatusCode != http.StatusBadRequest {
		defer resp.Body.Close()
		t.Fatalf("demote last admin: status %d, want 400: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
	// Account deletion uses the same serialized invariant and cannot remove
	// the final admin through a different endpoint.
	resp = doJSON(t, ts, http.MethodDelete, "/me", regular.AccessToken, nil)
	if resp.StatusCode != http.StatusConflict {
		defer resp.Body.Close()
		t.Fatalf("delete last admin: status %d, want 409: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/admin/flags", first.AccessToken, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("demoted user hitting admin route: status %d, want 403", resp.StatusCode)
	}
	resp.Body.Close()

	// Two admin-changing actions actually succeeded: promote(first→regular)
	// and demote(regular→first). The rejected self-demote attempt must NOT
	// appear — the guard runs before anything is written.
	resp = doJSON(t, ts, http.MethodGet, "/admin/actions", regular.AccessToken, nil)
	actions := decodeJSON[struct {
		Actions []struct {
			Action     string `json:"action"`
			ActorName  string `json:"actor_name"`
			TargetName string `json:"target_name"`
		} `json:"actions"`
	}](t, resp)
	if len(actions.Actions) != 2 {
		t.Fatalf("audit log = %+v, want exactly 2 entries", actions.Actions)
	}
	if actions.Actions[0].Action != "demote" || actions.Actions[0].ActorName != "Promotable Pat" || actions.Actions[0].TargetName != "FirstAdmin" {
		t.Errorf("most recent action = %+v, want Promotable Pat's demote of FirstAdmin", actions.Actions[0])
	}
	if actions.Actions[1].Action != "promote" || actions.Actions[1].TargetName != "Promotable Pat" {
		t.Errorf("oldest action = %+v, want the initial promotion of Promotable Pat", actions.Actions[1])
	}
}
