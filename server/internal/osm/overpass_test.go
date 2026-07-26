package osm

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFetchCourtElement(t *testing.T) {
	const body = `{"elements":[{
		"type":"way","id":222333444,
		"center":{"lat":30.30,"lon":-97.70},
		"tags":{"leisure":"pitch","sport":"basketball","surface":"concrete","lit":"yes","hoops":"2"}
	}]}`
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.FormValue("data")
		io.WriteString(w, body)
	}))
	defer srv.Close()

	court, err := FetchCourtElement(context.Background(), srv.URL, "way", 222333444)
	if err != nil {
		t.Fatalf("FetchCourtElement: %v", err)
	}
	if court == nil {
		t.Fatal("expected a court, got nil")
	}
	// The query must target this exact element by type/id.
	if !strings.Contains(gotQuery, "way(222333444)") {
		t.Errorf("query did not target the element: %q", gotQuery)
	}
	if court.Surface == nil || *court.Surface != "concrete" {
		t.Errorf("surface = %v, want concrete", court.Surface)
	}
	if court.Lighting == nil || !*court.Lighting {
		t.Errorf("lighting = %v, want true", court.Lighting)
	}
	if court.HoopCount == nil || *court.HoopCount != 2 {
		t.Errorf("hoop_count = %v, want 2", court.HoopCount)
	}
}

func TestFetchCourtElementRejectsBadType(t *testing.T) {
	if _, err := FetchCourtElement(context.Background(), "http://unused", "user", 1); err == nil {
		t.Fatal("expected an error for an invalid osm type")
	}
}

func TestFetchCourtElementMissingIsNotAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		io.WriteString(w, `{"elements":[]}`)
	}))
	defer srv.Close()

	court, err := FetchCourtElement(context.Background(), srv.URL, "node", 999)
	if err != nil {
		t.Fatalf("a stale/missing element should not error: %v", err)
	}
	if court != nil {
		t.Errorf("expected nil court for empty response, got %+v", court)
	}
}
