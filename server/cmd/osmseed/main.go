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
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/davisbrown/pull-up/server/internal/osm"
	"github.com/davisbrown/pull-up/server/internal/store"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

func main() {
	bboxFlag := flag.String("bbox", "", "bounding box: south,west,north,east (required)")
	endpoint := flag.String("endpoint", osm.DefaultOverpassEndpoint, "Overpass API endpoint")
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
	courts, err := osm.FetchCourts(ctx, *endpoint, bbox)
	if err != nil {
		log.Fatalf("overpass query: %v", err)
	}
	log.Printf("found %d candidate courts", len(courts))

	var inserted, updated int
	for _, c := range courts {
		row, err := st.Queries.UpsertOSMCourt(ctx, gen.UpsertOSMCourtParams{
			Name: c.Name, Lng: c.Lng, Lat: c.Lat,
			HoopCount: c.HoopCount, Indoor: c.Indoor, Surface: c.Surface, Lighting: c.Lighting,
			Access: c.Access, Fee: c.Fee, Covered: c.Covered,
			OpeningHours: c.OpeningHours, Website: c.Website, Description: c.Description,
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

func parseBBox(s string) (osm.BBox, error) {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return osm.BBox{}, fmt.Errorf("expected south,west,north,east")
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return osm.BBox{}, err
		}
		vals[i] = v
	}
	b := osm.BBox{South: vals[0], West: vals[1], North: vals[2], East: vals[3]}
	if b.South >= b.North || b.West >= b.East {
		return osm.BBox{}, fmt.Errorf("south<north and west<east required")
	}
	return b, nil
}

func isInserted(v any) bool {
	b, _ := v.(bool)
	return b
}
