-- +goose Up

-- Check-ins carry party size (guests aren't accounts) and ball status.
ALTER TABLE check_ins ADD COLUMN party_size smallint NOT NULL DEFAULT 1
    CHECK (party_size BETWEEN 1 AND 4);
ALTER TABLE check_ins ADD COLUMN has_ball boolean NOT NULL DEFAULT false;

-- Player-card profile fields. All optional, all structured (no free text).
ALTER TABLE users ADD COLUMN jersey_number smallint
    CHECK (jersey_number BETWEEN 0 AND 99);
ALTER TABLE users ADD COLUMN position text
    CHECK (position IN ('guard','wing','forward','center'));
ALTER TABLE users ADD COLUMN height_cm smallint
    CHECK (height_cm BETWEEN 120 AND 250);
ALTER TABLE users ADD COLUMN style_tags text[] NOT NULL DEFAULT '{}';

-- +goose Down
ALTER TABLE users DROP COLUMN style_tags;
ALTER TABLE users DROP COLUMN height_cm;
ALTER TABLE users DROP COLUMN position;
ALTER TABLE users DROP COLUMN jersey_number;
ALTER TABLE check_ins DROP COLUMN has_ball;
ALTER TABLE check_ins DROP COLUMN party_size;
