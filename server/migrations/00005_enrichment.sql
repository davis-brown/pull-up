-- +goose Up

-- Richer court attributes, mapped from OSM tags or filled by enrichment.
ALTER TABLE courts ADD COLUMN access text CHECK (access IN ('public','private','customers'));
ALTER TABLE courts ADD COLUMN fee boolean;
ALTER TABLE courts ADD COLUMN covered boolean;
ALTER TABLE courts ADD COLUMN opening_hours text;
ALTER TABLE courts ADD COLUMN website text;
ALTER TABLE courts ADD COLUMN description text;
-- Set when the lazy enrichment worker (Nominatim address + Commons photos)
-- has processed this court; NULL means not yet attempted.
ALTER TABLE courts ADD COLUMN enriched_at timestamptz;

-- Openly-licensed photos found near the court (e.g. Wikimedia Commons).
-- image_url is hotlinked from the source; attribution is displayed with it.
CREATE TABLE external_photos (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id    uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    source      text NOT NULL DEFAULT 'commons' CHECK (source IN ('commons')),
    source_id   text NOT NULL,
    image_url   text NOT NULL,
    page_url    text NOT NULL,
    attribution text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);
CREATE INDEX external_photos_court_idx ON external_photos (court_id);

-- +goose Down
DROP TABLE external_photos;
ALTER TABLE courts DROP COLUMN enriched_at;
ALTER TABLE courts DROP COLUMN description;
ALTER TABLE courts DROP COLUMN website;
ALTER TABLE courts DROP COLUMN opening_hours;
ALTER TABLE courts DROP COLUMN covered;
ALTER TABLE courts DROP COLUMN fee;
ALTER TABLE courts DROP COLUMN access;
