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
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return ParseCourts(body)
}
