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

func TestCheckInPartySize(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "partysize@test.local", "PartySize")
	court := createTestCourt(t, ts, u.AccessToken, "Party Court", ruckerLat, ruckerLng)

	// Valid party size + ball status: 201, echoed back in the response.
	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat, "lng": ruckerLng, "party_size": 3, "has_ball": true,
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("party-size check-in: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	checkIn := decodeJSON[struct {
		PartySize int  `json:"party_size"`
		HasBall   bool `json:"has_ball"`
	}](t, resp)
	if checkIn.PartySize != 3 || !checkIn.HasBall {
		t.Fatalf("check-in response = %+v, want party_size=3 has_ball=true", checkIn)
	}

	// Out-of-range party size (max 4): 400.
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/check-ins", u.AccessToken, map[string]any{
		"lat": ruckerLat, "lng": ruckerLng, "party_size": 9,
	})
	if resp.StatusCode != http.StatusBadRequest {
		defer resp.Body.Close()
		t.Fatalf("oversized party: status %d, want 400: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	// The court's live count is the sum of party sizes, not a row count.
	resp = doJSON(t, ts, http.MethodGet, "/courts?bbox=-73.946,40.819,-73.926,40.839", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bbox list: status %d", resp.StatusCode)
	}
	bboxResult := decodeJSON[struct {
		Courts []struct {
			ID          string `json:"id"`
			ActiveCount int    `json:"active_count"`
		} `json:"courts"`
	}](t, resp)
	if len(bboxResult.Courts) != 1 || bboxResult.Courts[0].ActiveCount != 3 {
		t.Fatalf("bbox result = %+v, want one court with active_count=3", bboxResult.Courts)
	}

	// The activity endpoint's active_count is the same party-size sum, and
	// each check-in entry carries its party size.
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/activity", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("activity: status %d", resp.StatusCode)
	}
	activity := decodeJSON[struct {
		ActiveCount int `json:"active_count"`
		CheckIns    []struct {
			PartySize int  `json:"party_size"`
			HasBall   bool `json:"has_ball"`
		} `json:"check_ins"`
	}](t, resp)
	if activity.ActiveCount != 3 {
		t.Errorf("activity active_count = %d, want 3 (party-size sum, not row count)", activity.ActiveCount)
	}
	if len(activity.CheckIns) != 1 || activity.CheckIns[0].PartySize != 3 || !activity.CheckIns[0].HasBall {
		t.Errorf("activity check_ins = %+v, want one entry with party_size=3 has_ball=true", activity.CheckIns)
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
