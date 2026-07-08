package api_test

import (
	"net/http"
	"testing"
)

func TestCheckInDistanceGuard(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "hooper@test.local", "Hooper")
	court := createTestCourt(t, ts, u.AccessToken, "Guarded Court", ruckerLat, ruckerLng)

	// ~5.5km away must be rejected as too far.
	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat + 0.05, "lng": ruckerLng,
	})
	if resp.StatusCode != http.StatusUnprocessableEntity {
		defer resp.Body.Close()
		t.Fatalf("far check-in: status %d, want 422: %s", resp.StatusCode, readBody(t, resp))
	}
	far := decodeJSON[map[string]any](t, resp)
	if far["distance_m"] == nil {
		t.Error("422 response should include distance_m")
	}

	// At the court succeeds and promotes a pending court (strongest
	// real-world signal it exists).
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat, "lng": ruckerLng,
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("at-court check-in: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID, "", nil)
	got := decodeJSON[courtResp](t, resp)
	if got.Status != "verified" {
		t.Errorf("court status after check-in = %q, want verified", got.Status)
	}
}

func TestCheckInOneActivePerUserAndHistory(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "switcher@test.local", "Switcher")
	courtA := createTestCourt(t, ts, u.AccessToken, "Court A", ruckerLat, ruckerLng)
	// Far enough from Court A (~5.5km) to not trip duplicate detection.
	courtB := createTestCourt(t, ts, u.AccessToken, "Court B", ruckerLat+0.05, ruckerLng)

	resp := doJSON(t, ts, http.MethodPost, "/courts/"+courtA.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat, "lng": ruckerLng,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("check in A: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodPost, "/courts/"+courtB.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat + 0.05, "lng": ruckerLng,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("check in B: status %d", resp.StatusCode)
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/me/check-ins/current", u.AccessToken, nil)
	current := decodeJSON[struct {
		CheckIn struct {
			CourtID string `json:"court_id"`
		} `json:"check_in"`
	}](t, resp)
	if current.CheckIn.CourtID != courtB.ID {
		t.Fatalf("current check-in court = %s, want %s", current.CheckIn.CourtID, courtB.ID)
	}

	resp = doJSON(t, ts, http.MethodGet, "/me/check-ins", u.AccessToken, nil)
	history := decodeJSON[struct {
		CheckIns []struct {
			CourtID      string  `json:"court_id"`
			CheckedOutAt *string `json:"checked_out_at"`
		} `json:"check_ins"`
	}](t, resp)
	if len(history.CheckIns) != 2 {
		t.Fatalf("history length = %d, want 2", len(history.CheckIns))
	}
	if history.CheckIns[0].CourtID != courtB.ID || history.CheckIns[0].CheckedOutAt != nil {
		t.Errorf("most recent history entry = %+v, want active court B", history.CheckIns[0])
	}
	if history.CheckIns[1].CourtID != courtA.ID || history.CheckIns[1].CheckedOutAt == nil {
		t.Errorf("older history entry = %+v, want checked-out court A", history.CheckIns[1])
	}

	// Explicit check-out clears the current check-in.
	resp = doJSON(t, ts, http.MethodDelete, "/check-ins/current", u.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("check out: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/me/check-ins/current", u.AccessToken, nil)
	current = decodeJSON[struct {
		CheckIn struct {
			CourtID string `json:"court_id"`
		} `json:"check_in"`
	}](t, resp)
	if current.CheckIn.CourtID != "" {
		t.Errorf("current check-in after checkout = %+v, want none", current.CheckIn)
	}
}

func TestCreateReportAndActivity(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "reporter2@test.local", "Reporter2")
	court := createTestCourt(t, ts, u.AccessToken, "Reported Court", ruckerLat, ruckerLng)

	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/reports", u.AccessToken, map[string]any{})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty report: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	playerCount := 8
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/reports", u.AccessToken, map[string]any{
		"player_count": playerCount, "run_quality": "good_run",
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("valid report: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/activity", "", nil)
	activity := decodeJSON[struct {
		ActiveCount int `json:"active_count"`
		Reports     []struct {
			PlayerCount int `json:"player_count"`
		} `json:"reports"`
	}](t, resp)
	if len(activity.Reports) != 1 || activity.Reports[0].PlayerCount != playerCount {
		t.Fatalf("activity reports = %+v, want one report with player_count %d", activity.Reports, playerCount)
	}
}
