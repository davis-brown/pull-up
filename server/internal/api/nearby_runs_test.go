package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type nearbyRun struct {
	ID          string  `json:"id"`
	CourtID     string  `json:"court_id"`
	CourtName   string  `json:"court_name"`
	DistanceM   float64 `json:"distance_m"`
	CreatedBy   string  `json:"created_by"`
	CreatedName string  `json:"created_by_name"`
	StartsAt    string  `json:"starts_at"`
	GoingCount  int     `json:"going_count"`
}

func planRun(t *testing.T, ts *httptest.Server, token, courtID string, startsAt time.Time) string {
	t.Helper()
	resp := doJSON(t, ts, http.MethodPost, "/courts/"+courtID+"/sessions", token, map[string]any{
		"starts_at": startsAt.Format(time.RFC3339),
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("plan run: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	return decodeJSON[map[string]any](t, resp)["id"].(string)
}

func TestNearbyRunsAndSummaryBadge(t *testing.T) {
	ts, _ := newTestServer(t)
	organizer := registerUser(t, ts, "nr-organizer@test.local", "Organizer")
	blocker := registerUser(t, ts, "nr-blocker@test.local", "Blocker")

	court := createTestCourt(t, ts, organizer.AccessToken, "Rail Court", ruckerLat, ruckerLng)
	// ~5.5km away: inside the 10km discovery radius but past dupe detection.
	quiet := createTestCourt(t, ts, organizer.AccessToken, "Quiet Court", ruckerLat+0.05, ruckerLng)
	// ~110km away: outside any allowed radius.
	far := createTestCourt(t, ts, organizer.AccessToken, "Far Court", ruckerLat+1, ruckerLng)

	nearRunID := planRun(t, ts, organizer.AccessToken, court.ID, time.Now().Add(3*time.Hour))
	planRun(t, ts, organizer.AccessToken, court.ID, time.Now().Add(30*time.Hour)) // past the 24h rail window
	planRun(t, ts, organizer.AccessToken, far.ID, time.Now().Add(3*time.Hour))    // out of radius

	nearbyPath := "/sessions/nearby?lat=40.829256&lng=-73.936192&radius_m=10000"

	// Guests discover the run: the whole point of the rail.
	resp := doJSON(t, ts, http.MethodGet, nearbyPath, "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("guest nearby runs: status %d", resp.StatusCode)
	}
	guest := decodeJSON[map[string][]nearbyRun](t, resp)
	if len(guest["runs"]) != 1 {
		t.Fatalf("guest runs = %d, want 1 (only the near, <24h run): %+v", len(guest["runs"]), guest["runs"])
	}
	run := guest["runs"][0]
	if run.ID != nearRunID || run.CourtName != "Rail Court" || run.GoingCount != 1 {
		t.Errorf("unexpected run row: %+v", run)
	}
	if run.DistanceM > 100 {
		t.Errorf("distance_m = %f, want ~0 (queried from the court itself)", run.DistanceM)
	}

	// Radius validation mirrors the courts endpoint.
	resp = doJSON(t, ts, http.MethodGet, "/sessions/nearby?lat=40.8&lng=-73.9&radius_m=999999", "", nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("oversized radius: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/sessions/nearby?lng=-73.9", "", nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("missing lat: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// Blocking the organizer removes their runs from the blocker's rail only.
	resp = doJSON(t, ts, http.MethodPut, "/users/"+organizer.User.ID+"/block", blocker.AccessToken, nil)
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		t.Fatalf("block organizer: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, nearbyPath, blocker.AccessToken, nil)
	blocked := decodeJSON[map[string][]nearbyRun](t, resp)
	if len(blocked["runs"]) != 0 {
		t.Errorf("blocker still sees %d runs, want 0", len(blocked["runs"]))
	}

	// The court summary payload carries next_run_at for the pin tick — set
	// for the court with a run inside 24h, null for the quiet court.
	resp = doJSON(t, ts, http.MethodGet, "/courts?lat=40.829256&lng=-73.936192&radius_m=10000", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("courts nearby: status %d", resp.StatusCode)
	}
	type summaryRow struct {
		ID        string  `json:"id"`
		NextRunAt *string `json:"next_run_at"`
	}
	courts := decodeJSON[struct {
		Courts []summaryRow `json:"courts"`
	}](t, resp)
	rows := map[string]*string{}
	for _, c := range courts.Courts {
		rows[c.ID] = c.NextRunAt
	}
	if rows[court.ID] == nil {
		t.Errorf("court with a 3h-out run has null next_run_at")
	}
	if got, ok := rows[quiet.ID]; !ok {
		t.Errorf("quiet court missing from nearby response")
	} else if got != nil {
		t.Errorf("quiet court next_run_at = %v, want null", *got)
	}
}
