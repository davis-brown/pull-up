// Package seeder auto-populates courts from OpenStreetMap: when a map
// viewport touches tiles that have never been imported, a background worker
// fetches that region from Overpass and upserts its courts. Each tile is
// imported at most once (claimed atomically in seed_regions), so the map
// self-populates worldwide with zero user input.
package seeder

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/osm"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// TileDeg is the tile grid size in degrees (~28 km of longitude at the
// equator, ~25 km of latitude): small enough for quick Overpass queries,
// large enough that a city is a handful of tiles.
const TileDeg = 0.25

// maxTilesPerRequest skips seeding for zoomed-out viewports — a whole-country
// view must not enqueue hundreds of imports.
const maxTilesPerRequest = 6

// courtesyDelay spaces successive Overpass queries (shared free service).
const courtesyDelay = 10 * time.Second

type Tile struct {
	X, Y int
}

func (t Tile) BBox() osm.BBox {
	return osm.BBox{
		West:  float64(t.X) * TileDeg,
		South: float64(t.Y) * TileDeg,
		East:  float64(t.X+1) * TileDeg,
		North: float64(t.Y+1) * TileDeg,
	}
}

// TilesCovering returns the grid tiles overlapping the bbox, or nil when the
// viewport spans more than maxTilesPerRequest tiles (too zoomed out).
func TilesCovering(minLng, minLat, maxLng, maxLat float64) []Tile {
	if minLng > maxLng || minLat > maxLat {
		return nil
	}
	x0 := int(math.Floor(minLng / TileDeg))
	x1 := int(math.Floor(maxLng / TileDeg))
	y0 := int(math.Floor(minLat / TileDeg))
	y1 := int(math.Floor(maxLat / TileDeg))
	n := (x1 - x0 + 1) * (y1 - y0 + 1)
	if n <= 0 || n > maxTilesPerRequest {
		return nil
	}
	tiles := make([]Tile, 0, n)
	for x := x0; x <= x1; x++ {
		for y := y0; y <= y1; y++ {
			tiles = append(tiles, Tile{X: x, Y: y})
		}
	}
	return tiles
}

type Seeder struct {
	queries  *gen.Queries
	endpoint string
	log      *slog.Logger
	requests chan Tile
}

func New(queries *gen.Queries, endpoint string, log *slog.Logger) *Seeder {
	if endpoint == "" {
		endpoint = osm.DefaultOverpassEndpoint
	}
	return &Seeder{
		queries:  queries,
		endpoint: endpoint,
		log:      log,
		requests: make(chan Tile, 128),
	}
}

// Request enqueues any unseeded tiles covering the viewport. Non-blocking
// and cheap — safe to call on every map query. Drops work when the queue is
// full; the next viewer of the same region re-triggers it.
func (s *Seeder) Request(minLng, minLat, maxLng, maxLat float64) {
	for _, tile := range TilesCovering(minLng, minLat, maxLng, maxLat) {
		select {
		case s.requests <- tile:
		default:
			return
		}
	}
}

// Run processes the import queue until ctx is cancelled. Run exactly one —
// a single worker plus courtesyDelay is the Overpass rate limit.
func (s *Seeder) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case tile := <-s.requests:
			if !s.claim(ctx, tile) {
				continue
			}
			s.importTile(ctx, tile)
			select {
			case <-ctx.Done():
				return
			case <-time.After(courtesyDelay):
			}
		}
	}
}

func (s *Seeder) claim(ctx context.Context, tile Tile) bool {
	_, err := s.queries.ClaimSeedTile(ctx, gen.ClaimSeedTileParams{TileX: int32(tile.X), TileY: int32(tile.Y)})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			s.log.Error("claim seed tile", "tile", tile, "err", err)
		}
		return false
	}
	return true
}

func (s *Seeder) importTile(ctx context.Context, tile Tile) {
	importCtx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()

	courts, err := osm.FetchCourts(importCtx, s.endpoint, tile.BBox())
	if err != nil {
		s.log.Error("overpass fetch", "tile", tile, "err", err)
		s.mark(ctx, tile, "failed", nil)
		return
	}
	for _, c := range courts {
		if _, err := s.queries.UpsertOSMCourt(importCtx, gen.UpsertOSMCourtParams{
			Name: c.Name, Lng: c.Lng, Lat: c.Lat,
			HoopCount: c.HoopCount, Indoor: c.Indoor, Surface: c.Surface, Lighting: c.Lighting,
			OsmType: &c.OSMType, OsmID: &c.OSMID,
		}); err != nil {
			s.log.Error("upsert osm court", "tile", tile, "err", err)
			s.mark(ctx, tile, "failed", nil)
			return
		}
	}
	found := int32(len(courts))
	s.mark(ctx, tile, "done", &found)
	s.log.Info("auto-seeded tile", "tile", tile, "courts", found)
}

func (s *Seeder) mark(ctx context.Context, tile Tile, status string, found *int32) {
	if err := s.queries.MarkSeedTile(ctx, gen.MarkSeedTileParams{
		TileX: int32(tile.X), TileY: int32(tile.Y), Status: status, CourtsFound: found,
	}); err != nil {
		s.log.Error("mark seed tile", "tile", tile, "err", err)
	}
}
