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
	"sync"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/davisbrown/pull-up/server/internal/osm"
	"github.com/davisbrown/pull-up/server/internal/store/gen"
)

// TileDeg is the tile grid size in degrees (~28 km of longitude at the
// equator, ~25 km of latitude).
const TileDeg = 0.25

// maxTilesPerRequest skips seeding for zoomed-out viewports — a whole-country
// view must not enqueue hundreds of imports.
const maxTilesPerRequest = 6

// courtesyDelay spaces successive Overpass queries (shared free service).
const courtesyDelay = 10 * time.Second

// idleFallback re-checks the queue even without a wake signal, covering work
// enqueued by another process or a signal dropped while the worker was busy.
// It is deliberately long: an idle 30s poll kept a pgx connection — and with
// it the Neon compute endpoint — awake for as long as the container lived.
const idleFallback = 15 * time.Minute

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
	if !validBBox(minLng, minLat, maxLng, maxLat) {
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

// TileRange returns the inclusive tile-index bounds covering the bbox and
// whether the viewport is seedable. ok=false for an invalid or too-zoomed-out
// bbox, mirroring the cap in TilesCovering.
func TileRange(minLng, minLat, maxLng, maxLat float64) (x0, x1, y0, y1 int, ok bool) {
	if !validBBox(minLng, minLat, maxLng, maxLat) {
		return 0, 0, 0, 0, false
	}
	x0 = int(math.Floor(minLng / TileDeg))
	x1 = int(math.Floor(maxLng / TileDeg))
	y0 = int(math.Floor(minLat / TileDeg))
	y1 = int(math.Floor(maxLat / TileDeg))
	n := (x1 - x0 + 1) * (y1 - y0 + 1)
	if n <= 0 || n > maxTilesPerRequest {
		return x0, x1, y0, y1, false
	}
	return x0, x1, y0, y1, true
}

func validBBox(minLng, minLat, maxLng, maxLat float64) bool {
	for _, v := range []float64{minLng, minLat, maxLng, maxLat} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return minLng >= -180 && maxLng <= 180 && minLat >= -90 && maxLat <= 90 &&
		minLng <= maxLng && minLat <= maxLat
}

type Seeder struct {
	queries  *gen.Queries
	endpoint string
	log      *slog.Logger
	// mu serializes tile imports so the Run loop and a concurrent
	// /internal/drain never fetch Overpass at once; courtesyDelay only spaces
	// imports within a single serialized run.
	mu sync.Mutex
	// wake carries "there is work" from Request to Run. Buffered to one and
	// sent without blocking, so a burst of enqueues coalesces into a single
	// wake-up and no request ever waits on the worker.
	wake chan struct{}
}

func New(queries *gen.Queries, endpoint string, log *slog.Logger) *Seeder {
	if endpoint == "" {
		endpoint = osm.DefaultOverpassEndpoint
	}
	return &Seeder{
		queries:  queries,
		endpoint: endpoint,
		log:      log,
		wake:     make(chan struct{}, 1),
	}
}

// Request durably enqueues any covering tiles for import, bounded by the tile
// cap and the caller's request context.
func (s *Seeder) Request(ctx context.Context, minLng, minLat, maxLng, maxLat float64) {
	tiles := TilesCovering(minLng, minLat, maxLng, maxLat)
	if len(tiles) == 0 {
		return
	}
	for _, t := range tiles {
		if err := s.queries.EnqueueSeedTile(ctx, gen.EnqueueSeedTileParams{
			TileX: int32(t.X), TileY: int32(t.Y),
		}); err != nil {
			s.log.Error("enqueue seed tile", "tile", t, "err", err)
		}
	}
	s.signal()
}

// ViewportSeeding reports whether the viewport is seedable and at least one
// covering tile hasn't finished importing — the signal for the client's
// "finding courts" state.
func (s *Seeder) ViewportSeeding(ctx context.Context, minLng, minLat, maxLng, maxLat float64) bool {
	x0, x1, y0, y1, ok := TileRange(minLng, minLat, maxLng, maxLat)
	if !ok {
		return false
	}
	settled, err := s.queries.CountSettledTilesInRange(ctx, gen.CountSettledTilesInRangeParams{
		MinX: int32(x0), MaxX: int32(x1), MinY: int32(y0), MaxY: int32(y1),
	})
	if err != nil {
		s.log.Error("count settled tiles", "err", err)
		return false
	}
	expected := int32((x1 - x0 + 1) * (y1 - y0 + 1))
	return settled < expected
}

// DrainOnce claims and imports the next tile, then spaces the next Overpass
// call by courtesyDelay. Reports whether it did any work.
func (s *Seeder) DrainOnce(ctx context.Context) bool {
	if !s.mu.TryLock() {
		return false
	}
	defer s.mu.Unlock()
	row, err := s.queries.ClaimNextSeedTile(ctx)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			s.log.Error("claim next seed tile", "err", err)
		}
		return false
	}
	s.importTile(ctx, Tile{X: int(row.TileX), Y: int(row.TileY)})
	select {
	case <-ctx.Done():
	case <-time.After(courtesyDelay):
	}
	return true
}

// Run drains the queue until ctx is cancelled, polling when idle. Run exactly
// one per process; DrainOnce's courtesyDelay is the Overpass rate limit.
func (s *Seeder) Run(ctx context.Context) {
	for {
		if ctx.Err() != nil {
			return
		}
		if s.DrainOnce(ctx) {
			continue
		}
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-time.After(idleFallback):
		}
	}
}

// signal nudges Run that work was enqueued. Never blocks: a full buffer
// already means Run has an unconsumed wake-up pending.
func (s *Seeder) signal() {
	if s.wake == nil {
		return
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
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
			Access: c.Access, Fee: c.Fee, Covered: c.Covered,
			FeeAmountCents: c.FeeAmount, FeeCurrency: c.FeeCurrency,
			OpeningHours: c.OpeningHours, Website: c.Website, Description: c.Description,
			Fenced:  c.Fenced,
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
