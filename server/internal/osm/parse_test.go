package osm

import "testing"

// Trimmed from a real Overpass "out center tags" response shape: one node,
// one way with center, one relation-ish element without coordinates.
const fixture = `{
  "version": 0.6,
  "elements": [
    {
      "type": "node",
      "id": 4213621234,
      "lat": 30.2672,
      "lon": -97.7431,
      "tags": {
        "leisure": "pitch",
        "sport": "basketball",
        "name": "Pan Am Park Court",
        "hoops": "4",
        "surface": "asphalt",
        "lit": "yes"
      }
    },
    {
      "type": "way",
      "id": 222333444,
      "center": { "lat": 30.30, "lon": -97.70 },
      "tags": {
        "leisure": "pitch",
        "sport": "basketball",
        "surface": "unhinged_novelty_surface",
        "indoor": "yes",
        "lit": "no"
      }
    },
    {
      "type": "way",
      "id": 999,
      "tags": { "leisure": "pitch", "sport": "basketball" }
    }
  ]
}`

func TestParseCourts(t *testing.T) {
	courts, err := ParseCourts([]byte(fixture))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(courts) != 2 {
		t.Fatalf("got %d courts, want 2 (element without coords must be skipped)", len(courts))
	}

	named := courts[0]
	if named.OSMType != "node" || named.OSMID != 4213621234 {
		t.Errorf("unexpected identity: %+v", named)
	}
	if named.Name != "Pan Am Park Court" {
		t.Errorf("name = %q", named.Name)
	}
	if named.HoopCount == nil || *named.HoopCount != 4 {
		t.Errorf("hoops = %v, want 4", named.HoopCount)
	}
	if named.Surface == nil || *named.Surface != "asphalt" {
		t.Errorf("surface = %v, want asphalt", named.Surface)
	}
	if named.Lighting == nil || !*named.Lighting {
		t.Errorf("lighting = %v, want true", named.Lighting)
	}
	if named.Indoor {
		t.Error("expected outdoor")
	}
	if named.Lat != 30.2672 || named.Lng != -97.7431 {
		t.Errorf("coords = %f,%f", named.Lat, named.Lng)
	}

	way := courts[1]
	if way.Name != "Basketball Court" {
		t.Errorf("fallback name = %q", way.Name)
	}
	if way.Lat != 30.30 || way.Lng != -97.70 {
		t.Errorf("way must use center coords, got %f,%f", way.Lat, way.Lng)
	}
	if way.Surface != nil {
		t.Errorf("unknown surface must map to nil, got %v", *way.Surface)
	}
	if !way.Indoor {
		t.Error("indoor=yes must map to true")
	}
	if way.Lighting == nil || *way.Lighting {
		t.Errorf("lit=no must map to false, got %v", way.Lighting)
	}
}

func TestParseCourtsRejectsGarbage(t *testing.T) {
	if _, err := ParseCourts([]byte("<html>rate limited</html>")); err == nil {
		t.Error("expected error for non-JSON body")
	}
}

func TestParseEnrichmentTags(t *testing.T) {
	body := []byte(`{"elements":[{"type":"way","id":42,"center":{"lat":40.7,"lon":-73.9},
		"tags":{"leisure":"pitch","sport":"basketball","access":"customers","fee":"yes",
		"covered":"no","opening_hours":"Mo-Su 08:00-22:00","website":"https://example.org/court",
		"description":"Two full courts behind the rec center."}}]}`)
	courts, err := ParseCourts(body)
	if err != nil || len(courts) != 1 {
		t.Fatalf("parse: %v (%d courts)", err, len(courts))
	}
	c := courts[0]
	if c.Access == nil || *c.Access != "customers" {
		t.Errorf("access = %v", c.Access)
	}
	if c.Fee == nil || !*c.Fee {
		t.Errorf("fee = %v", c.Fee)
	}
	if c.Covered == nil || *c.Covered {
		t.Errorf("covered = %v", c.Covered)
	}
	if c.OpeningHours == nil || *c.OpeningHours != "Mo-Su 08:00-22:00" {
		t.Errorf("opening_hours = %v", c.OpeningHours)
	}
	if c.Website == nil || *c.Website != "https://example.org/court" {
		t.Errorf("website = %v", c.Website)
	}
	if c.Description == nil {
		t.Error("description missing")
	}
	// Garbage access values must map to nil, not a guess.
	body2 := []byte(`{"elements":[{"type":"node","id":7,"lat":40.7,"lon":-73.9,
		"tags":{"access":"permit","website":"not-a-url"}}]}`)
	courts2, _ := ParseCourts(body2)
	if courts2[0].Access != nil || courts2[0].Website != nil {
		t.Errorf("bad values not nil: access=%v website=%v", courts2[0].Access, courts2[0].Website)
	}
}

func ptrBool(b bool) *bool { return &b }

func TestParseFenced(t *testing.T) {
	cases := []struct {
		tags map[string]string
		want *bool
	}{
		{map[string]string{"leisure": "pitch", "sport": "basketball", "fenced": "yes"}, ptrBool(true)},
		{map[string]string{"leisure": "pitch", "sport": "basketball", "barrier": "fence"}, ptrBool(true)},
		{map[string]string{"leisure": "pitch", "sport": "basketball"}, nil},
	}
	for _, c := range cases {
		got := parseFenced(c.tags)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("parseFenced(%v) = %v, want %v", c.tags, got, c.want)
		}
	}
}

func TestParseCharge(t *testing.T) {
	cases := []struct {
		name         string
		tags         map[string]string
		wantAmount   *int32
		wantCurrency string
	}{
		{"code after amount", map[string]string{"charge": "5 USD"}, ptrInt32(500), "USD"},
		{"decimal amount", map[string]string{"charge": "2.50 EUR"}, ptrInt32(250), "EUR"},
		{"decimal comma", map[string]string{"charge": "2,50 EUR"}, ptrInt32(250), "EUR"},
		{"symbol prefix", map[string]string{"charge": "€3"}, ptrInt32(300), "EUR"},
		{"rate suffix dropped", map[string]string{"charge": "5 EUR/hour"}, ptrInt32(500), "EUR"},
		{"zero-decimal currency not scaled", map[string]string{"charge": "500 JPY"}, ptrInt32(500), "JPY"},
		{"fee:amount fallback", map[string]string{"fee:amount": "10 GBP"}, ptrInt32(1000), "GBP"},

		// Rejected: an amount with no currency is unformattable, and the
		// courts table rejects the pair anyway.
		{"no currency", map[string]string{"charge": "5"}, nil, ""},
		{"bare dollar sign is ambiguous", map[string]string{"charge": "$5"}, nil, ""},
		{"no amount", map[string]string{"charge": "yes"}, nil, ""},
		{"absent", map[string]string{}, nil, ""},
		{"over the column ceiling", map[string]string{"charge": "999999 USD"}, nil, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			amount, currency := parseCharge(c.tags)
			if (amount == nil) != (c.wantAmount == nil) ||
				(amount != nil && *amount != *c.wantAmount) {
				t.Errorf("amount = %v, want %v", derefInt32(amount), derefInt32(c.wantAmount))
			}
			got := ""
			if currency != nil {
				got = *currency
			}
			if got != c.wantCurrency {
				t.Errorf("currency = %q, want %q", got, c.wantCurrency)
			}
		})
	}
}

// A parseable price implies a fee even where the fee=* tag is absent, since
// courts carrying charge=* often omit it.
func TestParseCourtsInfersFeeFromCharge(t *testing.T) {
	body := []byte(`{"elements":[{"type":"node","id":11,"lat":40.7,"lon":-73.9,
		"tags":{"charge":"5 USD"}}]}`)
	courts, err := ParseCourts(body)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	c := courts[0]
	if c.Fee == nil || !*c.Fee {
		t.Errorf("Fee = %v, want true", c.Fee)
	}
	if c.FeeAmount == nil || *c.FeeAmount != 500 {
		t.Errorf("FeeAmount = %v, want 500", derefInt32(c.FeeAmount))
	}

	// An explicit fee=no is not overridden — the tag is a stronger signal
	// than an inference, even when a stale charge value lingers.
	body2 := []byte(`{"elements":[{"type":"node","id":12,"lat":40.7,"lon":-73.9,
		"tags":{"fee":"no","charge":"5 USD"}}]}`)
	courts2, _ := ParseCourts(body2)
	if courts2[0].Fee == nil || *courts2[0].Fee {
		t.Errorf("Fee = %v, want false", courts2[0].Fee)
	}
}

func ptrInt32(v int32) *int32 { return &v }

func derefInt32(v *int32) any {
	if v == nil {
		return nil
	}
	return *v
}
