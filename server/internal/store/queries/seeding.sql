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

-- name: CountSettledTilesInRange :one
-- How many tiles in the (contiguous) covering rectangle have settled — either
-- imported ('done') or given up for now ('failed', retryable in 24h). A tile
-- that is never-claimed or still 'importing' is NOT settled, so the viewport is
-- still "seeding". Counting 'failed' as settled stops the client from polling
-- forever when a tile can't import.
SELECT count(*)::int AS settled
FROM seed_regions
WHERE tile_x BETWEEN sqlc.arg('min_x') AND sqlc.arg('max_x')
  AND tile_y BETWEEN sqlc.arg('min_y') AND sqlc.arg('max_y')
  AND status IN ('done', 'failed');

-- name: EnqueueSeedTile :exec
-- Durably records that a tile needs importing. A tile that already has any row
-- (pending/importing/done/failed) is untouched, so a done tile is never reset.
WITH capacity_lock AS (
    SELECT pg_advisory_xact_lock(1886743155)
)
INSERT INTO seed_regions (tile_x, tile_y, status)
SELECT $1, $2, 'pending'
FROM capacity_lock
WHERE (SELECT count(*) FROM seed_regions WHERE status IN ('pending', 'importing')) < 1000
ON CONFLICT (tile_x, tile_y) DO NOTHING;

-- name: ClaimNextSeedTile :one
-- Atomically claim the next claimable tile: pending, a failed tile past 24h, a
-- stale 'importing' tile (crashed worker) past 1h, or a 'done' tile past its
-- 90-day re-seed TTL. FOR UPDATE SKIP LOCKED makes concurrent workers safe.
UPDATE seed_regions SET status = 'importing', updated_at = now()
WHERE (tile_x, tile_y) = (
    SELECT tile_x, tile_y FROM seed_regions
    WHERE status = 'pending'
       OR (status = 'failed'    AND updated_at < now() - interval '24 hours')
       OR (status = 'importing' AND updated_at < now() - interval '1 hour')
       OR (status = 'done'      AND updated_at < now() - interval '90 days')
    ORDER BY updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING tile_x, tile_y;
