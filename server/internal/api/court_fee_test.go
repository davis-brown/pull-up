package api_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Mirrors the api package's unexported ceiling; this is an external test
// package, so the constant is restated rather than imported.
const maxFeeNoteLen = 80

// The cost/access fields as they appear on both the summary and detail
// payloads, so one shape covers list responses and GET /courts/{id}.
type courtCostResp struct {
	ID             string  `json:"id"`
	IsPublic       bool    `json:"is_public"`
	Access         *string `json:"access"`
	Fee            *bool   `json:"fee"`
	FeeAmountCents *int32  `json:"fee_amount_cents"`
	FeeCurrency    *string `json:"fee_currency"`
	FeeNote        *string `json:"fee_note"`
}

func getCourtCost(t *testing.T, ts *httptest.Server, id string) courtCostResp {
	t.Helper()
	resp := doJSON(t, ts, http.MethodGet, "/courts/"+id, "", nil)
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("get court: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	return decodeJSON[courtCostResp](t, resp)
}

func TestCreateCourtWithFeeAndAccess(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "payer@test.local", "Payer")

	resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, map[string]any{
		"name": "Chelsea Piers", "lat": ruckerLat, "lng": ruckerLng, "indoor": true,
		"access": "customers", "fee": true,
		"fee_amount_cents": 500, "fee_currency": "usd", "fee_note": "  drop-in  ",
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("create paid court: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	created := decodeJSON[courtCostResp](t, resp)

	got := getCourtCost(t, ts, created.ID)
	if got.Access == nil || *got.Access != "customers" {
		t.Errorf("access = %v, want customers", got.Access)
	}
	if got.Fee == nil || !*got.Fee {
		t.Errorf("fee = %v, want true", got.Fee)
	}
	if got.FeeAmountCents == nil || *got.FeeAmountCents != 500 {
		t.Errorf("fee_amount_cents = %v, want 500", got.FeeAmountCents)
	}
	// Currency is upper-cased and the note trimmed on the way in.
	if got.FeeCurrency == nil || *got.FeeCurrency != "USD" {
		t.Errorf("fee_currency = %v, want USD", got.FeeCurrency)
	}
	if got.FeeNote == nil || *got.FeeNote != "drop-in" {
		t.Errorf("fee_note = %v, want %q", got.FeeNote, "drop-in")
	}
	// An unstated is_public follows a restrictive access rather than staying
	// contradictory.
	if got.IsPublic {
		t.Error("is_public = true, want false for access=customers")
	}
}

// A price with no fee flag is itself the assertion that the court charges.
func TestCreateCourtInfersFeeFromAmount(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "inferfee@test.local", "Infer")

	resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, map[string]any{
		"name": "Priced Court", "lat": ruckerLat, "lng": ruckerLng, "indoor": false,
		"fee_amount_cents": 1500, "fee_currency": "USD",
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	created := decodeJSON[courtCostResp](t, resp)

	got := getCourtCost(t, ts, created.ID)
	if got.Fee == nil || !*got.Fee {
		t.Errorf("fee = %v, want true (inferred from the amount)", got.Fee)
	}
}

func TestCreateCourtFeeValidation(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "feeinvalid@test.local", "Invalid")

	cases := []struct {
		name string
		body map[string]any
	}{
		{"amount without currency", map[string]any{"fee_amount_cents": 500}},
		{"currency not a 3-letter code", map[string]any{
			"fee_amount_cents": 500, "fee_currency": "dollars"}},
		{"amount contradicts fee=false", map[string]any{
			"fee": false, "fee_amount_cents": 500, "fee_currency": "USD"}},
		{"amount over the ceiling", map[string]any{
			"fee_amount_cents": 1000001, "fee_currency": "USD"}},
		{"negative amount", map[string]any{
			"fee_amount_cents": -1, "fee_currency": "USD"}},
		{"note too long", map[string]any{
			"fee":      true,
			"fee_note": strings.Repeat("x", maxFeeNoteLen+1)}},
		{"invalid access", map[string]any{"access": "members-only"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body := map[string]any{
				"name": "Fee Case " + c.name, "lat": ruckerLat, "lng": ruckerLng,
				"indoor": false, "ignore_duplicates": true,
			}
			for k, v := range c.body {
				body[k] = v
			}
			resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, body)
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("status %d, want 400: %s", resp.StatusCode, readBody(t, resp))
			}
		})
	}
}

// The patch endpoint coalesces, so an amount-only edit is valid against a
// currency the court already has — but not against one it lacks.
func TestPatchCourtFeeAmountUsesStoredCurrency(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "patchfee@test.local", "Patcher")

	resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, map[string]any{
		"name": "Repriced Court", "lat": ruckerLat, "lng": ruckerLng, "indoor": false,
		"fee": true, "fee_amount_cents": 500, "fee_currency": "EUR",
	})
	if resp.StatusCode != http.StatusCreated {
		defer resp.Body.Close()
		t.Fatalf("create: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	court := decodeJSON[courtCostResp](t, resp)

	resp = doJSON(t, ts, http.MethodPatch, "/courts/"+court.ID+"/attributes",
		u.AccessToken, map[string]any{"fee_amount_cents": 750})
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		t.Fatalf("patch amount only: status %d: %s", resp.StatusCode, readBody(t, resp))
	}
	resp.Body.Close()

	got := getCourtCost(t, ts, court.ID)
	if got.FeeAmountCents == nil || *got.FeeAmountCents != 750 {
		t.Errorf("fee_amount_cents = %v, want 750", got.FeeAmountCents)
	}
	if got.FeeCurrency == nil || *got.FeeCurrency != "EUR" {
		t.Errorf("fee_currency = %v, want the stored EUR", got.FeeCurrency)
	}

	// The same edit on a court with no stored currency is a 400, not a 500
	// from the table's amount/currency constraint.
	free := createTestCourt(t, ts, u.AccessToken, "Free Court", ruckerLat+0.01, ruckerLng+0.01)
	resp = doJSON(t, ts, http.MethodPatch, "/courts/"+free.ID+"/attributes",
		u.AccessToken, map[string]any{"fee_amount_cents": 750})
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("amount with no currency anywhere: status %d, want 400", resp.StatusCode)
	}
}

// public and free are tri-state: true keeps open/no-charge courts, false keeps
// only their inverse, and absent is unfiltered.
func TestListCourtsFiltersByCostAndAccess(t *testing.T) {
	ts, _ := newTestServer(t)
	u := registerUser(t, ts, "costfilter@test.local", "Filter")

	mk := func(name string, extra map[string]any) string {
		body := map[string]any{
			"name": name, "lat": ruckerLat, "lng": ruckerLng, "indoor": false,
			"ignore_duplicates": true,
		}
		for k, v := range extra {
			body[k] = v
		}
		resp := doJSON(t, ts, http.MethodPost, "/courts", u.AccessToken, body)
		if resp.StatusCode != http.StatusCreated {
			defer resp.Body.Close()
			t.Fatalf("create %s: status %d: %s", name, resp.StatusCode, readBody(t, resp))
		}
		return decodeJSON[courtCostResp](t, resp).ID
	}

	freeOpen := mk("Free Open Court", nil)
	paid := mk("Paid Court", map[string]any{
		"fee": true, "fee_amount_cents": 500, "fee_currency": "USD"})
	private := mk("Private Court", map[string]any{"access": "private"})

	const bbox = "/courts?bbox=-73.946,40.819,-73.926,40.839"
	ids := func(query string) map[string]bool {
		resp := doJSON(t, ts, http.MethodGet, query, "", nil)
		if resp.StatusCode != http.StatusOK {
			defer resp.Body.Close()
			t.Fatalf("list %s: status %d", query, resp.StatusCode)
		}
		result := decodeJSON[struct {
			Courts []courtCostResp `json:"courts"`
		}](t, resp)
		out := map[string]bool{}
		for _, c := range result.Courts {
			out[c.ID] = true
		}
		return out
	}

	all := ids(bbox)
	if !all[freeOpen] || !all[paid] || !all[private] {
		t.Fatalf("unfiltered list missing courts: %v", all)
	}

	// free=true excludes the paid court; free=false keeps only it.
	if got := ids(bbox + "&free=true"); !got[freeOpen] || got[paid] {
		t.Errorf("free=true = %v, want the free court and not the paid one", got)
	}
	if got := ids(bbox + "&free=false"); !got[paid] || got[freeOpen] || got[private] {
		t.Errorf("free=false = %v, want only the paid court", got)
	}

	// public=true excludes the private court; public=false keeps only it.
	if got := ids(bbox + "&public=true"); !got[freeOpen] || got[private] {
		t.Errorf("public=true = %v, want the open court and not the private one", got)
	}
	if got := ids(bbox + "&public=false"); !got[private] || got[freeOpen] {
		t.Errorf("public=false = %v, want only the private court", got)
	}
}
