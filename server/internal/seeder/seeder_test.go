package seeder

import "testing"

func TestTilesCoveringSingleTile(t *testing.T) {
	// A small viewport inside one tile.
	tiles := TilesCovering(-73.99, 40.75, -73.98, 40.76)
	if len(tiles) != 1 {
		t.Fatalf("got %d tiles, want 1", len(tiles))
	}
	want := Tile{X: -296, Y: 163} // floor(-73.99/0.25), floor(40.75/0.25)
	if tiles[0] != want {
		t.Errorf("tile = %+v, want %+v", tiles[0], want)
	}
}

func TestTilesCoveringSpansBoundaries(t *testing.T) {
	// Viewport straddling a tile boundary in both axes → 4 tiles.
	tiles := TilesCovering(-0.1, -0.1, 0.1, 0.1)
	if len(tiles) != 4 {
		t.Fatalf("got %d tiles, want 4", len(tiles))
	}
}

func TestTilesCoveringZoomedOutSkipped(t *testing.T) {
	// A country-sized viewport must not enqueue imports.
	if tiles := TilesCovering(-125, 25, -66, 49); tiles != nil {
		t.Errorf("expected nil for huge viewport, got %d tiles", len(tiles))
	}
}

func TestTilesCoveringInvalidBBox(t *testing.T) {
	if tiles := TilesCovering(10, 10, -10, -10); tiles != nil {
		t.Errorf("expected nil for inverted bbox, got %d tiles", len(tiles))
	}
}

func TestTileBBoxRoundTrip(t *testing.T) {
	tile := Tile{X: -296, Y: 163}
	b := tile.BBox()
	if b.West != -74.0 || b.East != -73.75 || b.South != 40.75 || b.North != 41.0 {
		t.Errorf("bbox = %+v", b)
	}
	// The tile's own bbox must map back to exactly that tile.
	tiles := TilesCovering(b.West+0.01, b.South+0.01, b.East-0.01, b.North-0.01)
	if len(tiles) != 1 || tiles[0] != tile {
		t.Errorf("round trip failed: %+v", tiles)
	}
}

func TestTileRange(t *testing.T) {
	// A tiny bbox inside one tile → 1×1, seedable.
	x0, x1, y0, y1, ok := TileRange(0.1, 0.1, 0.2, 0.2)
	if !ok || x0 != x1 || y0 != y1 {
		t.Fatalf("single-tile bbox: got (%d,%d,%d,%d) ok=%v", x0, x1, y0, y1, ok)
	}
	// A huge bbox spanning more than the tile cap → not seedable.
	if _, _, _, _, ok := TileRange(0, 0, 10, 10); ok {
		t.Error("oversized viewport should be ok=false")
	}
	// Inverted bbox → not seedable.
	if _, _, _, _, ok := TileRange(1, 1, 0, 0); ok {
		t.Error("inverted bbox should be ok=false")
	}
}
