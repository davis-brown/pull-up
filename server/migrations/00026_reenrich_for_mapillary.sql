-- +goose Up
-- Migration 00025 backfilled for Mapillary, but the container never actually
-- received MAPILLARY_TOKEN: the Worker->container env passthrough in
-- deploy/api/src/index.ts was missing it, so that backfill ran with Mapillary
-- silently disabled and every court completed with zero Mapillary photos.
-- With the passthrough fixed, re-open the courts that completed under the
-- broken run so they re-enrich now that the token reaches the Go process.
-- Re-enrichment is idempotent: addresses/amenities are filled only where null
-- and photo inserts are ON CONFLICT DO NOTHING.
UPDATE courts SET enriched_at = NULL, enrich_claimed_at = NULL
WHERE enriched_at IS NOT NULL;

-- +goose Down
-- No-op: nothing to restore, and re-enrichment is safe to repeat.
SELECT 1;
