// Pure, node-safe: mirrors the server seeder's tile cap so the map knows when a
// viewport is too zoomed-out to auto-seed, and picks the empty-state to show.
export const SEED_TILE_DEG = 0.25;
export const SEED_MAX_TILES = 6;

export function viewportTooLarge(bbox: {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}): boolean {
  const nx = Math.floor(bbox.maxLng / SEED_TILE_DEG) - Math.floor(bbox.minLng / SEED_TILE_DEG) + 1;
  const ny = Math.floor(bbox.maxLat / SEED_TILE_DEG) - Math.floor(bbox.minLat / SEED_TILE_DEG) + 1;
  return nx * ny > SEED_MAX_TILES;
}

export type CourtsDisplay = "has-courts" | "seeding" | "zoomed-out" | "empty";

export function courtsDisplayState(o: {
  courtCount: number;
  seeding: boolean;
  viewportTooLarge: boolean;
}): CourtsDisplay {
  if (o.courtCount > 0) return "has-courts";
  if (o.viewportTooLarge) return "zoomed-out";
  if (o.seeding) return "seeding";
  return "empty";
}
