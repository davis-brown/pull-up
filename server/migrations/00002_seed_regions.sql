-- +goose Up
-- Tracks which 0.25°×0.25° map tiles have been auto-seeded from OSM, so each
-- region is imported at most once (with retry backoff for failures).
CREATE TABLE seed_regions (
    tile_x       int NOT NULL,
    tile_y       int NOT NULL,
    status       text NOT NULL CHECK (status IN ('importing','done','failed')),
    courts_found int,
    seeded_at    timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tile_x, tile_y)
);

-- +goose Down
DROP TABLE seed_regions;
