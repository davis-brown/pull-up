package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
)

func TestFavoritesEndpoints(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "favoriter@test.local", "Favoriter")
	court := createTestCourt(t, ts, u.AccessToken, "Favorite Court", ruckerLat, ruckerLng)

	resp := doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/favorite", u.AccessToken, nil)
	fav := decodeJSON[map[string]bool](t, resp)
	if fav["favorite"] {
		t.Fatal("court should not start out favorited")
	}

	resp = doJSON(t, ts, http.MethodPut, "/courts/"+court.ID+"/favorite", u.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("add favorite: status %d", resp.StatusCode)
	}
	fav = decodeJSON[map[string]bool](t, resp)
	if !fav["favorite"] {
		t.Fatal("add favorite should report favorite: true")
	}

	resp = doJSON(t, ts, http.MethodGet, "/me/favorites", u.AccessToken, nil)
	list := decodeJSON[struct {
		Courts []courtResp `json:"courts"`
	}](t, resp)
	if len(list.Courts) != 1 || list.Courts[0].ID != court.ID {
		t.Fatalf("favorites list = %+v, want just %s", list.Courts, court.ID)
	}

	resp = doJSON(t, ts, http.MethodDelete, "/courts/"+court.ID+"/favorite", u.AccessToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("remove favorite: status %d", resp.StatusCode)
	}
	fav = decodeJSON[map[string]bool](t, resp)
	if fav["favorite"] {
		t.Fatal("remove favorite should report favorite: false")
	}
}

func TestPushTokenRegistration(t *testing.T) {
	ts, st := newTestServer(t)
	u := registerUser(t, ts, "pushuser@test.local", "PushUser")
	other := registerUser(t, ts, "pushother@test.local", "PushOther")

	resp := doJSON(t, ts, http.MethodPost, "/me/push-token", u.AccessToken, map[string]string{"token": ""})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty token: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/me/push-token", u.AccessToken, map[string]string{"token": "ExponentPushToken[abc123]"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("register token: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	// A token can only be unregistered by its current owner.
	resp = doJSON(t, ts, http.MethodDelete, "/me/push-token", other.AccessToken,
		map[string]string{"token": "ExponentPushToken[abc123]"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("other user unregister: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	var count int
	if err := st.Pool.QueryRow(context.Background(),
		"SELECT count(*) FROM push_tokens WHERE token = $1", "ExponentPushToken[abc123]").Scan(&count); err != nil {
		t.Fatalf("count push token: %v", err)
	}
	if count != 1 {
		t.Fatal("another user was able to unregister the token")
	}
	resp = doJSON(t, ts, http.MethodDelete, "/me/push-token", u.AccessToken,
		map[string]string{"token": "ExponentPushToken[abc123]"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("owner unregister: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	if err := st.Pool.QueryRow(context.Background(),
		"SELECT count(*) FROM push_tokens WHERE token = $1", "ExponentPushToken[abc123]").Scan(&count); err != nil {
		t.Fatalf("count deleted push token: %v", err)
	}
	if count != 0 {
		t.Fatal("owner unregister did not remove the token")
	}
}

func TestPhotoUploadFlow(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "shutterbug@test.local", "Shutterbug")
	court := createTestCourt(t, ts, u.AccessToken, "Photogenic Court", ruckerLat, ruckerLng)

	resp := doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/photos", "", nil)
	empty := decodeJSON[struct {
		Photos []map[string]any `json:"photos"`
	}](t, resp)
	if len(empty.Photos) != 0 {
		t.Fatalf("new court should have no photos, got %+v", empty.Photos)
	}

	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/photos", u.AccessToken, map[string]any{})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("create photo: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	created := decodeJSON[struct {
		Photo struct {
			ID string `json:"id"`
		} `json:"photo"`
		UploadPath          string `json:"upload_path"`
		UploadAuthorization string `json:"upload_authorization"`
	}](t, resp)
	if created.Photo.ID == "" {
		t.Fatal("create photo did not return a photo id")
	}
	if !strings.HasPrefix(created.UploadPath, "/photos/upload/courts/"+court.ID+"/") {
		t.Errorf("upload_path = %q, want it scoped to the court's storage prefix", created.UploadPath)
	}
	if strings.Contains(created.UploadPath, "?") || !strings.HasPrefix(created.UploadAuthorization, "PullUp-Upload ") {
		t.Errorf("upload capability leaked into URL or header missing: path=%q authorization=%q",
			created.UploadPath, created.UploadAuthorization)
	}
	storageKey := strings.TrimPrefix(created.UploadPath, "/photos/upload/")
	resp = doJSONHeaders(t, ts, http.MethodPost, "/internal/media/uploaded", "",
		map[string]string{"key": storageKey}, map[string]string{"X-Internal-Task": "test-internal-secret"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("finalize photo: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/photos", "", nil)
	list := decodeJSON[struct {
		Photos []map[string]any `json:"photos"`
	}](t, resp)
	if len(list.Photos) != 1 {
		t.Fatalf("photos after upload = %+v, want 1", list.Photos)
	}
}
