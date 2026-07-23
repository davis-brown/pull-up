package enrich

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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
	// ~80 m half-width is well under 0.01° of latitude; sanity-check the span.
	if span := maxLat - minLat; span <= 0 || span > 0.01 {
		t.Errorf("lat span %v out of expected range", span)
	}
}

// serveMapillary points mapillaryBaseURL at a test server and restores it.
func serveMapillary(t *testing.T, h http.HandlerFunc) *Enricher {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	old := mapillaryBaseURL
	mapillaryBaseURL = srv.URL
	t.Cleanup(func() { mapillaryBaseURL = old })
	return &Enricher{client: srv.Client(), mapillaryToken: "test-token"}
}

// A dense-city box trips the data limit; the enricher shrinks and retries, and
// the smaller box succeeds.
func TestMapillaryPhotosShrinksOnDataLimit(t *testing.T) {
	var calls int
	e := serveMapillary(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			io.WriteString(w, `{"error":{"code":1,"message":"Please reduce the amount of data you're asking for"}}`)
			return
		}
		io.WriteString(w, `{"data":[{"id":"42","thumb_1024_url":"https://img/42.jpg"}]}`)
	})
	got, err := e.mapillaryPhotos(context.Background(), 40.75, -73.98)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls != 2 {
		t.Errorf("expected a shrink-retry (2 calls), got %d", calls)
	}
	if len(got) != 1 || got[0].sourceID != "42" {
		t.Fatalf("expected the smaller box's photo, got %+v", got)
	}
}

// The data limit persists even at the smaller box: best-effort, so no error and
// no photos (a failing court must not retry forever).
func TestMapillaryPhotosDataLimitPersists(t *testing.T) {
	e := serveMapillary(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"error":{"code":1,"message":"reduce"}}`)
	})
	got, err := e.mapillaryPhotos(context.Background(), 40.75, -73.98)
	if err != nil {
		t.Fatalf("persistent data limit should be best-effort, got error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected no photos, got %d", len(got))
	}
}

// A non-data-limit API error (e.g. auth) must surface, not be swallowed as
// "zero photos" — the exact failure mode that hid a broken token in prod.
func TestMapillaryPhotosApiErrorSurfaces(t *testing.T) {
	e := serveMapillary(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"error":{"code":190,"message":"invalid token"}}`)
	})
	if _, err := e.mapillaryPhotos(context.Background(), 40.75, -73.98); err == nil {
		t.Fatal("expected the API error to be surfaced")
	}
}
