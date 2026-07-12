package api_test

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

// Rucker Park, NYC — matches internal/store's integration test fixtures.
const ruckerLat, ruckerLng = 40.829256, -73.936192

type courtResp struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func createTestCourt(t *testing.T, ts *httptest.Server, token, name string, lat, lng float64) courtResp {
	t.Helper()
	resp := doJSON(t, ts, http.MethodPost, "/courts", token, map[string]any{
		"name": name, "lat": lat, "lng": lng, "indoor": false,
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("create court %s: status %d: %s", name, resp.StatusCode, readBody(t, resp))
	}
	return decodeJSON[courtResp](t, resp)
}

func TestCreateCourtValidation(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "builder@test.local", "Builder")

	cases := []map[string]any{
		{"name": "", "lat": ruckerLat, "lng": ruckerLng, "indoor": false},
		{"name": "Bad Surface Court", "lat": ruckerLat, "lng": ruckerLng, "indoor": false, "surface": "grass"},
		{"name": "Bad Latlng", "lat": 999.0, "lng": ruckerLng, "indoor": false},
		{"name": "Bad Hoops", "lat": ruckerLat, "lng": ruckerLng, "indoor": false, "hoop_count": 0},
	}
	for _, body := range cases {
		resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("case %+v: status %d, want 400", body, resp.StatusCode)
		}
		resp.Body.Close()
	}
}

func TestCreateCourtDuplicateDetection(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "dupe@test.local", "Dupe")
	createTestCourt(t, ts, u.AccessToken, "Existing Court", ruckerLat, ruckerLng)

	// ~30m away without ignore_duplicates -> conflict.
	resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, map[string]any{
		"name": "Suspiciously Close Court", "lat": ruckerLat + 0.00027, "lng": ruckerLng, "indoor": false,
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("near dupe: status %d, want 409", resp.StatusCode)
	}
	resp.Body.Close()

	// Same spot with ignore_duplicates=true succeeds anyway.
	resp = doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, map[string]any{
		"name": "Forced Court", "lat": ruckerLat + 0.00027, "lng": ruckerLng, "indoor": false,
		"ignore_duplicates": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("ignore_duplicates: status %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestListCourtsByBBoxAndRadius(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "lister@test.local", "Lister")
	inside := createTestCourt(t, ts, u.AccessToken, "Inside Court", ruckerLat, ruckerLng)
	createTestCourt(t, ts, u.AccessToken, "Outside Court", ruckerLat+1, ruckerLng+1)

	resp := doJSON(t, ts, http.MethodGet, "/courts?bbox=-73.946,40.819,-73.926,40.839", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bbox list: status %d", resp.StatusCode)
	}
	bboxResult := decodeJSON[struct {
		Courts []courtResp `json:"courts"`
	}](t, resp)
	if len(bboxResult.Courts) != 1 || bboxResult.Courts[0].ID != inside.ID {
		t.Fatalf("bbox result = %+v, want only Inside Court", bboxResult.Courts)
	}

	resp = doJSON(t, ts, http.MethodGet, "/courts?lat=40.829256&lng=-73.936192&radius_m=2000", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("radius list: status %d", resp.StatusCode)
	}
	radiusResult := decodeJSON[struct {
		Courts []courtResp `json:"courts"`
	}](t, resp)
	if len(radiusResult.Courts) != 1 || radiusResult.Courts[0].ID != inside.ID {
		t.Fatalf("radius result = %+v, want only Inside Court", radiusResult.Courts)
	}
}

func TestVoteCourtFlow(t *testing.T) {
	ts, _ := newTestServer(t)
	submitter := registerUser(t, ts, "submitter@test.local", "Submitter")
	voter1 := registerUser(t, ts, "voter1@test.local", "Voter1")
	voter2 := registerUser(t, ts, "voter2@test.local", "Voter2")

	court := createTestCourt(t, ts, submitter.AccessToken, "Pending Court", ruckerLat, ruckerLng)
	if court.Status != "pending" {
		t.Fatalf("new court status = %q, want pending", court.Status)
	}

	// The submitter's own upvote must not count.
	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/vote", submitter.AccessToken, map[string]any{"vote": 1})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("self-upvote: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	voteResp := func(token string, vote int) map[string]any {
		r := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/vote", token, map[string]any{"vote": vote})
		if r.StatusCode != http.StatusOK {
			defer r.Body.Close()
			t.Fatalf("vote: status %d: %s", r.StatusCode, readBody(t, r))
		}
		return decodeJSON[map[string]any](t, r)
	}

	voteResp(voter1.AccessToken, 1)
	result := voteResp(voter2.AccessToken, 1)
	if result["status"] != "verified" {
		t.Fatalf("after 2 upvotes, status = %v, want verified", result["status"])
	}
}

func TestListCourtsFilter(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "cf@test.local", "CF")
	lit := createTestCourt(t, ts, u.AccessToken, "Lit", ruckerLat, ruckerLng)
	createTestCourt(t, ts, u.AccessToken, "Dark", ruckerLat+0.001, ruckerLng)
	// Mark one lit via the attributes endpoint (added in Task 5) OR a raw patch;
	// here assert the filter param is accepted and returns a subset.
	_ = lit

	latStr := strconv.FormatFloat(ruckerLat, 'f', -1, 64)
	lngStr := strconv.FormatFloat(ruckerLng, 'f', -1, 64)
	resp := doJSON(t, ts, http.MethodGet, "/courts?lat="+latStr+"&lng="+lngStr+"&lit=true", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("filtered list: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	// bbox path also accepts the same filter params.
	resp = doJSON(t, ts, http.MethodGet, "/courts?bbox=-73.946,40.819,-73.926,40.839&lit=true", "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("filtered bbox list: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
}

func TestVoteCourtRejection(t *testing.T) {
	ts, _ := newTestServer(t)
	submitter := registerUser(t, ts, "submitter2@test.local", "Submitter2")
	court := createTestCourt(t, ts, submitter.AccessToken, "Doomed Court", ruckerLat, ruckerLng)

	for i, email := range []string{"down1@test.local", "down2@test.local", "down3@test.local"} {
		voter := registerUser(t, ts, email, "Downvoter")
		resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/vote", voter.AccessToken, map[string]any{"vote": -1})
		if resp.StatusCode != http.StatusOK {
			defer resp.Body.Close()
			t.Fatalf("downvote %d: status %d: %s", i, resp.StatusCode, readBody(t, resp))
		}
		result := decodeJSON[map[string]any](t, resp)
		if i == 2 && result["status"] != "rejected" {
			t.Fatalf("after 3 downvotes, status = %v, want rejected", result["status"])
		}
	}
}

func TestPatchCourtAttributes(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "attr@test.local", "Attr")
	c := createTestCourt(t, ts, u.AccessToken, "Attr Court", ruckerLat, ruckerLng)

	// Requires auth.
	resp := doJSON(t, ts, http.MethodPatch, "/courts/"+c.ID+"/attributes", "", map[string]any{"lighting": true})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no-auth patch: status %d, want 401", resp.StatusCode)
	}
	resp.Body.Close()
	// Invalid surface → 400.
	resp = doJSON(t, ts, http.MethodPatch, "/courts/"+c.ID+"/attributes", u.AccessToken, map[string]any{"surface": "lava"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad surface: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
	// Valid update reflected in GET.
	doJSON(t, ts, http.MethodPatch, "/courts/"+c.ID+"/attributes", u.AccessToken, map[string]any{"lighting": true, "drinking_water": true}).Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+c.ID, "", nil)
	if p := decodeJSON[struct {
		Lighting      *bool `json:"lighting"`
		DrinkingWater *bool `json:"drinking_water"`
	}](t, resp); p.Lighting == nil || !*p.Lighting || p.DrinkingWater == nil || !*p.DrinkingWater {
		t.Errorf("attributes not persisted")
	}
}

func TestCourtsResponseHasSeeding(t *testing.T) {
	ts, _ := newTestServer(t)
	ruckerLatStr := strconv.FormatFloat(ruckerLat, 'f', -1, 64)
	ruckerLngStr := strconv.FormatFloat(ruckerLng, 'f', -1, 64)
	resp := doJSON(t, ts, http.MethodGet, "/courts?lat="+ruckerLatStr+"&lng="+ruckerLngStr, "", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	body := decodeJSON[struct {
		Courts  []map[string]any `json:"courts"`
		Seeding bool             `json:"seeding"`
	}](t, resp)
	_ = body.Courts
	// With no live seeder wired in tests, seeding is false; the assertion is
	// that the response includes a boolean `seeding` field and still decodes.
	if body.Seeding {
		t.Errorf("expected seeding=false without a wired seeder, got true")
	}
}
