-- +goose Up
ALTER TABLE courts ADD COLUMN drinking_water boolean;
ALTER TABLE courts ADD COLUMN toilets        boolean;
ALTER TABLE courts ADD COLUMN parking        boolean;
ALTER TABLE courts ADD COLUMN fenced         boolean;

CREATE TABLE court_attribute_edits (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id   uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    editor_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    field      text NOT NULL,
    old_value  text,
    new_value  text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX court_attribute_edits_court_idx ON court_attribute_edits (court_id, created_at DESC);

-- +goose Down
DROP TABLE court_attribute_edits;
ALTER TABLE courts DROP COLUMN fenced;
ALTER TABLE courts DROP COLUMN parking;
ALTER TABLE courts DROP COLUMN toilets;
ALTER TABLE courts DROP COLUMN drinking_water;
