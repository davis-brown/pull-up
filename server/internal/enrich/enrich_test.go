package enrich

import "testing"

func TestParseOverpassAmenities(t *testing.T) {
	els := []overpassElement{
		{Tags: map[string]string{"amenity": "drinking_water"}},
		{Tags: map[string]string{"amenity": "parking"}},
	}
	water, toilets, parking := parseOverpassAmenities(els)
	if !water || toilets || !parking {
		t.Errorf("got water=%v toilets=%v parking=%v; want true false true", water, toilets, parking)
	}
	if w, tl, p := parseOverpassAmenities(nil); w || tl || p {
		t.Errorf("empty payload should be all false, got %v %v %v", w, tl, p)
	}
}
