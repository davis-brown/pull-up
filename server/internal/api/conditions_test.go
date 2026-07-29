package api_test

import (
	"net/http"
	"testing"
)

func TestCourtFactConfirmations(t *testing.T) {
	ts, _ := newTestServer(t)
	u1 := registerUser(t, ts, "facts1@test.local", "Facts One")
	u2 := registerUser(t, ts, "facts2@test.local", "Facts Two")
	u3 := registerUser(t, ts, "facts3@test.local", "Facts Three")
	court := createTestCourt(t, ts, u1.AccessToken, "Fact Court", ruckerLat, ruckerLng)

	resp := doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u1.AccessToken, map[string]any{
		"fact": "vibes", "value": "immaculate",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown fact: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u1.AccessToken, map[string]any{
		"fact": "rim_type", "value": "triple",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid value: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()

	// First confirmation sets the court's stored value to the majority (of one).
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u1.AccessToken, map[string]any{
		"fact": "rim_type", "value": "double",
	})
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("confirm rim: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	facts := decodeJSON[struct {
		Facts []struct {
			Fact            string `json:"fact"`
			Confirmations   int    `json:"confirmations"`
			MajorityValue   string `json:"majority_value"`
			LastConfirmedAt string `json:"last_confirmed_at"`
		} `json:"facts"`
	}](t, resp)
	if len(facts.Facts) != 1 || facts.Facts[0].MajorityValue != "double" || facts.Facts[0].Confirmations != 1 {
		t.Fatalf("facts after first confirm = %+v", facts.Facts)
	}

	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID, "", nil)
	detail := decodeJSON[struct {
		RimType *string `json:"rim_type"`
	}](t, resp)
	if detail.RimType == nil || *detail.RimType != "double" {
		t.Fatalf("court rim_type = %v, want double", detail.RimType)
	}

	// Two other players disagree; the majority flips the stored value.
	for _, u := range []testUser{u2, u3} {
		resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u.AccessToken, map[string]any{
			"fact": "rim_type", "value": "single",
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("confirm rim (dissent): status %d", resp.StatusCode)
		}
		resp.Body.Close()
	}
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID, "", nil)
	detail = decodeJSON[struct {
		RimType *string `json:"rim_type"`
	}](t, resp)
	if detail.RimType == nil || *detail.RimType != "single" {
		t.Fatalf("court rim_type after majority flip = %v, want single", detail.RimType)
	}

	// Boolean facts convert to the column type; public facts endpoint lists both.
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u1.AccessToken, map[string]any{
		"fact": "lighting", "value": "yes",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("confirm lighting: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID+"/facts", "", nil)
	facts = decodeJSON[struct {
		Facts []struct {
			Fact            string `json:"fact"`
			Confirmations   int    `json:"confirmations"`
			MajorityValue   string `json:"majority_value"`
			LastConfirmedAt string `json:"last_confirmed_at"`
		} `json:"facts"`
	}](t, resp)
	if len(facts.Facts) != 2 {
		t.Fatalf("public facts = %+v, want lighting + rim_type", facts.Facts)
	}
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID, "", nil)
	lit := decodeJSON[struct {
		Lighting *bool `json:"lighting"`
	}](t, resp)
	if lit.Lighting == nil || *lit.Lighting != true {
		t.Fatalf("court lighting = %v, want true", lit.Lighting)
	}

	// A hoop_count bucket confirmation parses to the integer column.
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u1.AccessToken, map[string]any{
		"fact": "hoop_count", "value": "4",
	})
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("confirm hoop_count: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()
	// An off-bucket value is rejected by the allowlist.
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u1.AccessToken, map[string]any{
		"fact": "hoop_count", "value": "3",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("off-bucket hoop_count: status %d, want 400", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u1.AccessToken, map[string]any{
		"fact": "covered", "value": "yes",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("confirm covered: status %d", resp.StatusCode)
	}
	resp.Body.Close()
	resp = doJSON(t, ts, http.MethodGet, "/courts/"+court.ID, "", nil)
	attrs := decodeJSON[struct {
		HoopCount *int  `json:"hoop_count"`
		Covered   *bool `json:"covered"`
	}](t, resp)
	if attrs.HoopCount == nil || *attrs.HoopCount != 4 {
		t.Fatalf("court hoop_count = %v, want 4", attrs.HoopCount)
	}
	if attrs.Covered == nil || *attrs.Covered != true {
		t.Fatalf("court covered = %v, want true", attrs.Covered)
	}

	// Re-confirming replaces the user's row, not adds to it.
	resp = doJSON(t, ts, http.MethodPost, "/courts/"+court.ID+"/facts", u1.AccessToken, map[string]any{
		"fact": "rim_type", "value": "single",
	})
	facts = decodeJSON[struct {
		Facts []struct {
			Fact            string `json:"fact"`
			Confirmations   int    `json:"confirmations"`
			MajorityValue   string `json:"majority_value"`
			LastConfirmedAt string `json:"last_confirmed_at"`
		} `json:"facts"`
	}](t, resp)
	for _, f := range facts.Facts {
		if f.Fact == "rim_type" && f.Confirmations != 3 {
			t.Fatalf("rim_type confirmations after reconfirm = %d, want 3", f.Confirmations)
		}
	}
}
