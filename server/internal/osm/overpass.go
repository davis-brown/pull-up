package osm

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const DefaultOverpassEndpoint = "https://overpass-api.de/api/interpreter"

type BBox struct {
	South, West, North, East float64
}

func (b BBox) String() string {
	return fmt.Sprintf("%f,%f,%f,%f", b.South, b.West, b.North, b.East)
}

// FetchCourtElement fetches a single OSM element by type/id, for backfilling
// attributes onto a known court. Returns (nil, nil) when the element no longer
// exists or has no usable geometry — a stale reference is not an error.
// Overpass is a shared free service; callers must rate-limit themselves.
func FetchCourtElement(ctx context.Context, endpoint, osmType string, osmID int64) (*Court, error) {
	switch osmType {
	case "node", "way", "relation":
	default:
		return nil, fmt.Errorf("invalid osm type %q", osmType)
	}
	query := fmt.Sprintf("[out:json][timeout:25];%s(%d);out center tags;", osmType, osmID)
	body, err := runOverpass(ctx, endpoint, query)
	if err != nil {
		return nil, err
	}
	courts, err := ParseCourts(body)
	if err != nil {
		return nil, err
	}
	if len(courts) == 0 {
		return nil, nil
	}
	return &courts[0], nil
}

// FetchCourts queries the Overpass API for basketball courts in the bbox.
// Overpass is a shared free service — callers must rate-limit themselves.
func FetchCourts(ctx context.Context, endpoint string, b BBox) ([]Court, error) {
	coords := b.String()
	query := fmt.Sprintf(`[out:json][timeout:120];
(
  node["leisure"="pitch"]["sport"="basketball"](%s);
  way["leisure"="pitch"]["sport"="basketball"](%s);
);
out center tags;`, coords, coords)
	body, err := runOverpass(ctx, endpoint, query)
	if err != nil {
		return nil, err
	}
	return ParseCourts(body)
}

// runOverpass POSTs a query to an Overpass endpoint and returns the raw body.
func runOverpass(ctx context.Context, endpoint, query string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
		strings.NewReader(url.Values{"data": {query}}.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "pull-up-osmseed/0.1 (basketball court finder; see repository README)")

	client := &http.Client{Timeout: 3 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
		return nil, fmt.Errorf("overpass returned %s: %s", resp.Status, snippet)
	}
	return io.ReadAll(resp.Body)
}
