-- +goose Up
-- Structured player-profile fields (settings chips, no free text):
-- skill level and typical availability windows.
ALTER TABLE users
    ADD COLUMN skill_level text,
    ADD COLUMN availability text[] NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE users
    DROP COLUMN skill_level,
    DROP COLUMN availability;
