// Command osmseed imports basketball courts from OpenStreetMap via the
// Overpass API into the courts table.
//
//	DATABASE_URL=... go run ./cmd/osmseed -bbox 30.19,-97.87,30.40,-97.65
//
// Imported courts are © OpenStreetMap contributors, licensed ODbL
// (https://www.openstreetmap.org/copyright). They are stored with
// source='osm' and their OSM ids so the derived subset stays separable and
// re-runs are idempotent (upsert on osm_type+osm_id, never touching status).
//
// Overpass is a shared free service: this command sends one query per run,
// with a descriptive User-Agent. For large imports (whole countries), use a
// Geofabrik extract with osmium instead of hammering Overpass.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/davisbrown/pull-up/server/internal/osm"
	"github.com/davisbrown/pull-up/server/internal/store"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

const overpassURL = "https://overpass-api.de/api/interpreter"

func main() {
	bboxFlag := flag.String("bbox", "", "bounding box: south,west,north,east (required)")
	endpoint := flag.String("endpoint", overpassURL, "Overpass API endpoint")
	flag.Parse()

	bbox, err := parseBBox(*bboxFlag)
	if err != nil {
		log.Fatalf("invalid -bbox: %v", err)
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx := context.Background()
	st, err := store.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	log.Printf("querying Overpass for basketball courts in bbox %s ...", *bboxFlag)
	body, err := queryOverpass(ctx, *endpoint, bbox)
	if err != nil {
		log.Fatalf("overpass query: %v", err)
	}

	courts, err := osm.ParseCourts(body)
	if err != nil {
		log.Fatalf("parse overpass response: %v", err)
	}
	log.Printf("found %d candidate courts", len(courts))

	var inserted, updated int
	for _, c := range courts {
		row, err := st.Queries.UpsertOSMCourt(ctx, gen.UpsertOSMCourtParams{
			Name: c.Name, Lng: c.Lng, Lat: c.Lat,
			HoopCount: c.HoopCount, Indoor: c.Indoor, Surface: c.Surface, Lighting: c.Lighting,
			OsmType: &c.OSMType, OsmID: &c.OSMID,
		})
		if err != nil {
			log.Fatalf("upsert %s/%d: %v", c.OSMType, c.OSMID, err)
		}
		if isInserted(row.Inserted) {
			inserted++
		} else {
			updated++
		}
	}
	log.Printf("done: %d inserted, %d updated", inserted, updated)
}

type bbox struct{ south, west, north, east float64 }

func parseBBox(s string) (bbox, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return bbox{}, fmt.Errorf("expected south,west,north,east")
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return bbox{}, err
		}
		vals[i] = v
	}
	b := bbox{south: vals[0], west: vals[1], north: vals[2], east: vals[3]}
	if b.south >= b.north || b.west >= b.east {
		return bbox{}, fmt.Errorf("south<north and west<east required")
	}
	return b, nil
}

func queryOverpass(ctx context.Context, endpoint string, b bbox) ([]byte, error) {
	coords := fmt.Sprintf("%f,%f,%f,%f", b.south, b.west, b.north, b.east)
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
	return io.ReadAll(resp.Body)
}

func isInserted(v any) bool {
	b, _ := v.(bool)
	return b
}
