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
