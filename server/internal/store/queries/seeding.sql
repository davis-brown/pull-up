-- name: ClaimSeedTile :one
-- Atomically claims a tile for import. Returns a row only when this caller
-- won the claim: brand-new tile, a failed tile past its retry backoff, or an
-- 'importing' tile stale enough to be a crashed worker.
INSERT INTO seed_regions (tile_x, tile_y, status)
VALUES ($1, $2, 'importing')
ON CONFLICT (tile_x, tile_y) DO UPDATE SET
    status = 'importing',
    updated_at = now()
WHERE (seed_regions.status = 'failed' AND seed_regions.updated_at < now() - interval '24 hours')
   OR (seed_regions.status = 'importing' AND seed_regions.updated_at < now() - interval '1 hour')
   OR (seed_regions.status = 'done' AND seed_regions.updated_at < now() - interval '90 days')
RETURNING tile_x;

-- name: MarkSeedTile :exec
UPDATE seed_regions
SET status = $3, courts_found = $4, seeded_at = now(), updated_at = now()
WHERE tile_x = $1 AND tile_y = $2;

-- name: CountDoneTilesInRange :one
-- How many tiles in the (contiguous) covering rectangle are already imported.
SELECT count(*)::int AS done
FROM seed_regions
WHERE tile_x BETWEEN sqlc.arg('min_x') AND sqlc.arg('max_x')
  AND tile_y BETWEEN sqlc.arg('min_y') AND sqlc.arg('max_y')
  AND status = 'done';
