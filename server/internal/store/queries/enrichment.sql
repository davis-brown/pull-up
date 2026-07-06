-- Lazy court enrichment: Nominatim reverse-geocoded addresses and
-- Wikimedia Commons photos, fetched once per court on first detail view.

-- Atomically claims a court for enrichment; pgx.ErrNoRows means another
-- request already claimed it (or the id doesn't exist).
-- name: ClaimCourtEnrichment :one
UPDATE courts SET enriched_at = now()
WHERE id = $1 AND enriched_at IS NULL
RETURNING id,
    ST_Y(location::geometry)::float8 AS lat,
    ST_X(location::geometry)::float8 AS lng,
    (address IS NULL)::bool AS needs_address;

-- Never clobber an address a user (or OSM) already provided.
-- name: SetCourtAddressIfNull :exec
UPDATE courts SET address = $2, updated_at = now()
WHERE id = $1 AND address IS NULL;

-- name: InsertExternalPhoto :exec
INSERT INTO external_photos (court_id, source, source_id, image_url, page_url, attribution)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (source, source_id) DO NOTHING;

-- name: ListExternalPhotos :many
SELECT id, source, source_id, image_url, page_url, attribution, created_at
FROM external_photos
WHERE court_id = $1
ORDER BY created_at
LIMIT 8;
