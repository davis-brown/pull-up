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

-- name: SetCourtAmenitiesIfNull :exec
-- Fill amenity booleans only where still unknown (never clobber crowd/OSM values).
UPDATE courts SET
    drinking_water = coalesce(drinking_water, sqlc.narg('drinking_water')),
    toilets        = coalesce(toilets, sqlc.narg('toilets')),
    parking        = coalesce(parking, sqlc.narg('parking')),
    updated_at     = now()
WHERE id = sqlc.arg('id');

-- name: ListExternalPhotos :many
SELECT id, source, source_id, image_url, page_url, attribution, created_at
FROM external_photos
WHERE court_id = $1 AND status = 'visible'
ORDER BY created_at
LIMIT 8;

-- name: SetExternalPhotoStatus :execrows
UPDATE external_photos SET status = $2
WHERE id = $1;

-- name: GetVisibleExternalPhotoURL :one
-- Resolve a cached external photo's upstream image URL for the Worker's
-- read-through R2 cache. Only visible rows resolve, so hiding a photo makes
-- every read 404 immediately regardless of what R2 already cached.
SELECT image_url
FROM external_photos
WHERE source = $1 AND source_id = $2 AND status = 'visible';

-- name: RequestEnrichment :exec
-- Durable, lazy: mark a viewed court for enrichment (once) if not already done.
UPDATE courts SET enrich_requested_at = now()
WHERE id = $1 AND enrich_requested_at IS NULL AND enriched_at IS NULL;

-- name: ClaimNextCourtEnrichment :one
-- Claim the next requested-but-unenriched court with a retryable lease.
-- enriched_at is written only by MarkCourtEnrichmentComplete.
UPDATE courts SET enrich_claimed_at = now(), enrich_attempts = enrich_attempts + 1
WHERE id = (
    SELECT id FROM courts
    WHERE enrich_requested_at IS NOT NULL AND enriched_at IS NULL
      AND (enrich_claimed_at IS NULL OR enrich_claimed_at < now() - interval '15 minutes')
    ORDER BY enrich_requested_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING id,
    ST_Y(location::geometry)::float8 AS lat,
    ST_X(location::geometry)::float8 AS lng,
    (address IS NULL)::bool AS needs_address;

-- name: MarkCourtEnrichmentComplete :exec
UPDATE courts
SET enriched_at = now(), enrich_claimed_at = NULL
WHERE id = $1;
