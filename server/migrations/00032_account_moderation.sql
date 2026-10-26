-- +goose Up
ALTER TABLE users ADD COLUMN suspended_at timestamptz;
ALTER TABLE users ADD COLUMN content_consent_version text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE users DROP COLUMN suspended_at;
ALTER TABLE users DROP COLUMN content_consent_version;
