package geocode

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestSearchParsesBoundsAndCachesNormalizedQuery(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if got := r.Header.Get("User-Agent"); got == "" {
			t.Error("missing User-Agent")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"display_name":"Harlem, Manhattan, New York","lat":"40.8116","lon":"-73.9465","boundingbox":["40.7850","40.8390","-73.9650","-73.9210"],"addresstype":"neighbourhood"},
			{"display_name":"broken","lat":"nope","lon":"-73","boundingbox":[]}
		]`))
	}))
	defer upstream.Close()

	client := New(Options{BaseURL: upstream.URL, Client: upstream.Client()})
	areas, err := client.Search(context.Background(), "  Harlem ", nil, nil)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(areas) != 1 || areas[0].Name != "Harlem, Manhattan, New York" || areas[0].BBox != [4]float64{-73.965, 40.785, -73.921, 40.839} {
		t.Fatalf("areas = %+v", areas)
	}
	if _, err := client.Search(context.Background(), "harlem", nil, nil); err != nil {
		t.Fatalf("cached search: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("upstream calls = %d, want 1", calls.Load())
	}
}

func TestSearchReturnsEmptySliceNotNil(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer upstream.Close()

	client := New(Options{BaseURL: upstream.URL, Client: upstream.Client()})
	// A nil slice would encode as JSON null, which the app's typed
	// AreaSearchHit[] cannot handle.
	for _, pass := range []string{"fresh", "cached"} {
		areas, err := client.Search(context.Background(), "nowhere", nil, nil)
		if err != nil {
			t.Fatalf("%s search: %v", pass, err)
		}
		if areas == nil {
			t.Fatalf("%s search returned a nil slice, want empty", pass)
		}
	}
}

func TestReverseBuildsShortAddress(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"address":{"house_number":"280","road":"West 155th Street","neighbourhood":"Harlem"}}`))
	}))
	defer upstream.Close()

	address, err := New(Options{BaseURL: upstream.URL, Client: upstream.Client()}).Reverse(context.Background(), 40.83, -73.94)
	if err != nil {
		t.Fatalf("reverse: %v", err)
	}
	if address != "280 West 155th Street, Harlem" {
		t.Fatalf("address = %q", address)
	}
}
