-- +goose Up
ALTER TABLE seed_regions DROP CONSTRAINT seed_regions_status_check;
ALTER TABLE seed_regions ADD CONSTRAINT seed_regions_status_check
    CHECK (status IN ('pending','importing','done','failed'));
CREATE INDEX seed_regions_pending_idx ON seed_regions (updated_at) WHERE status = 'pending';

ALTER TABLE courts ADD COLUMN enrich_requested_at timestamptz;
CREATE INDEX courts_enrich_pending_idx ON courts (enrich_requested_at)
    WHERE enrich_requested_at IS NOT NULL AND enriched_at IS NULL;

-- +goose Down
DROP INDEX courts_enrich_pending_idx;
ALTER TABLE courts DROP COLUMN enrich_requested_at;
DROP INDEX seed_regions_pending_idx;
-- Coerce any queued-but-unstarted tiles so the narrower CHECK can be re-added.
UPDATE seed_regions SET status = 'failed' WHERE status = 'pending';
ALTER TABLE seed_regions DROP CONSTRAINT seed_regions_status_check;
ALTER TABLE seed_regions ADD CONSTRAINT seed_regions_status_check
    CHECK (status IN ('importing','done','failed'));
