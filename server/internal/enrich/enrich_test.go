package enrich

import (
	"encoding/json"
	"testing"
)

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

// Real Graph API shape: a data array of images. Entries missing an id or
// thumbnail are dropped rather than stored with a broken URL.
func TestParseMapillary(t *testing.T) {
	const body = `{"data":[
		{"id":"1001","thumb_1024_url":"https://img.example/1001.jpg"},
		{"id":"1002","thumb_1024_url":""},
		{"id":"","thumb_1024_url":"https://img.example/x.jpg"},
		{"id":"1003","thumb_1024_url":"https://img.example/1003.jpg"}
	]}`
	var resp mapillaryResponse
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got := parseMapillary(resp)
	if len(got) != 2 {
		t.Fatalf("got %d photos, want 2 (two entries dropped)", len(got))
	}
	if got[0].sourceID != "1001" || got[0].imageURL != "https://img.example/1001.jpg" {
		t.Errorf("first photo mismapped: %+v", got[0])
	}
	if got[0].pageURL != "https://www.mapillary.com/app/?pKey=1001" {
		t.Errorf("page url = %q", got[0].pageURL)
	}
	if got[0].attribution == nil || *got[0].attribution != mapillaryAttribution {
		t.Errorf("attribution = %v, want %q", got[0].attribution, mapillaryAttribution)
	}
}

func TestBBox(t *testing.T) {
	lat, lng := 40.0, -74.0
	minLng, minLat, maxLng, maxLat := bbox(lat, lng, mapillaryRadiusM)
	if !(minLng < lng && lng < maxLng && minLat < lat && lat < maxLat) {
		t.Fatalf("box does not bracket point: %v", []float64{minLng, minLat, maxLng, maxLat})
	}
	// ~150 m north-south is well under 0.01° of latitude; sanity-check the span.
	if span := maxLat - minLat; span <= 0 || span > 0.01 {
		t.Errorf("lat span %v out of expected range", span)
	}
}
