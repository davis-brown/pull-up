-- +goose Up
-- Add Mapillary as a second auto-photo source alongside Wikimedia Commons.
ALTER TABLE external_photos DROP CONSTRAINT external_photos_source_check;
ALTER TABLE external_photos ADD CONSTRAINT external_photos_source_check
    CHECK (source IN ('commons', 'mapillary'));

-- Backfill: re-queue every court so already-enriched ones pick up Mapillary
-- photos (and re-check Commons/amenities). Enrichment gates on enriched_at;
-- nulling it re-opens the court. enrich_requested_at stays set from prior
-- views, so the background worker backfills those without waiting for a
-- re-view — throttled to one court at a time by the enricher's courtesy delay.
UPDATE courts SET enriched_at = NULL, enrich_claimed_at = NULL;

-- +goose Down
-- Mark everything enriched again so rollback doesn't trigger a re-enrich storm.
UPDATE courts SET enriched_at = now() WHERE enriched_at IS NULL;
DELETE FROM external_photos WHERE source = 'mapillary';
ALTER TABLE external_photos DROP CONSTRAINT external_photos_source_check;
ALTER TABLE external_photos ADD CONSTRAINT external_photos_source_check
    CHECK (source IN ('commons'));
