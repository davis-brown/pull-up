-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX courts_name_trgm_idx ON courts USING gin (name gin_trgm_ops)
WHERE status <> 'rejected';

-- +goose Down
DROP INDEX IF EXISTS courts_name_trgm_idx;
