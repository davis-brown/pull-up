-- name: CourtsInBBox :many
SELECT
    c.id, c.name,
    ST_Y(c.location::geometry)::float8 AS lat,
    ST_X(c.location::geometry)::float8 AS lng,
    c.address, c.hoop_count, c.indoor, c.surface, c.lighting, c.is_public,
    c.source, c.status,
    ac.active_count,
    lr.player_count AS latest_player_count,
    lr.run_quality  AS latest_run_quality,
    coalesce(lr.created_at, 'epoch'::timestamptz) AS latest_report_at
FROM courts c
LEFT JOIN LATERAL (
    SELECT count(*)::int AS active_count
    FROM check_ins ci
    WHERE ci.court_id = c.id AND ci.checked_out_at IS NULL AND ci.expires_at > now()
) ac ON true
LEFT JOIN LATERAL (
    SELECT cr.player_count, cr.run_quality, cr.created_at
    FROM crowd_reports cr
    WHERE cr.court_id = c.id AND cr.created_at > now() - interval '2 hours'
    ORDER BY cr.created_at DESC
    LIMIT 1
) lr ON true
WHERE c.status <> 'rejected'
  AND c.location && ST_MakeEnvelope(
        sqlc.arg(min_lng)::float8, sqlc.arg(min_lat)::float8,
        sqlc.arg(max_lng)::float8, sqlc.arg(max_lat)::float8, 4326)::geography
LIMIT 200;

-- name: CourtsNearby :many
SELECT
    c.id, c.name,
    ST_Y(c.location::geometry)::float8 AS lat,
    ST_X(c.location::geometry)::float8 AS lng,
    c.address, c.hoop_count, c.indoor, c.surface, c.lighting, c.is_public,
    c.source, c.status,
    ST_Distance(c.location, ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography)::float8 AS distance_m,
    ac.active_count,
    lr.player_count AS latest_player_count,
    lr.run_quality  AS latest_run_quality,
    coalesce(lr.created_at, 'epoch'::timestamptz) AS latest_report_at
FROM courts c
LEFT JOIN LATERAL (
    SELECT count(*)::int AS active_count
    FROM check_ins ci
    WHERE ci.court_id = c.id AND ci.checked_out_at IS NULL AND ci.expires_at > now()
) ac ON true
LEFT JOIN LATERAL (
    SELECT cr.player_count, cr.run_quality, cr.created_at
    FROM crowd_reports cr
    WHERE cr.court_id = c.id AND cr.created_at > now() - interval '2 hours'
    ORDER BY cr.created_at DESC
    LIMIT 1
) lr ON true
WHERE c.status <> 'rejected'
  AND ST_DWithin(c.location, ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography, sqlc.arg(radius_m)::float8)
ORDER BY distance_m
LIMIT 100;

-- name: GetCourt :one
SELECT
    c.id, c.name,
    ST_Y(c.location::geometry)::float8 AS lat,
    ST_X(c.location::geometry)::float8 AS lng,
    c.address, c.hoop_count, c.indoor, c.surface, c.lighting, c.is_public,
    c.access, c.fee, c.covered, c.opening_hours, c.website, c.description,
    c.source, c.osm_type, c.osm_id, c.status, c.submitted_by, c.created_at,
    c.enriched_at,
    ac.active_count,
    vs.net_votes
FROM courts c
LEFT JOIN LATERAL (
    SELECT count(*)::int AS active_count
    FROM check_ins ci
    WHERE ci.court_id = c.id AND ci.checked_out_at IS NULL AND ci.expires_at > now()
) ac ON true
LEFT JOIN LATERAL (
    SELECT coalesce(sum(v.vote), 0)::int AS net_votes
    FROM court_votes v
    WHERE v.court_id = c.id
) vs ON true
WHERE c.id = $1;

-- name: FindNearbyCourts :many
SELECT
    c.id, c.name,
    ST_Y(c.location::geometry)::float8 AS lat,
    ST_X(c.location::geometry)::float8 AS lng,
    c.status,
    ST_Distance(c.location, ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography)::float8 AS distance_m
FROM courts c
WHERE c.status <> 'rejected'
  AND ST_DWithin(c.location, ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography, sqlc.arg(radius_m)::float8)
ORDER BY distance_m
LIMIT 10;

-- name: CreateCourt :one
INSERT INTO courts (name, location, address, hoop_count, indoor, surface, lighting, is_public, source, status, submitted_by)
VALUES (
    sqlc.arg(name),
    ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography,
    sqlc.narg(address), sqlc.narg(hoop_count), sqlc.arg(indoor), sqlc.narg(surface), sqlc.narg(lighting),
    sqlc.arg(is_public), 'user', 'pending', sqlc.arg(submitted_by)
)
RETURNING id, name, ST_Y(location::geometry)::float8 AS lat, ST_X(location::geometry)::float8 AS lng,
    address, hoop_count, indoor, surface, lighting, is_public, source, status, submitted_by, created_at;

-- name: UpsertOSMCourt :one
INSERT INTO courts (name, location, hoop_count, indoor, surface, lighting,
    access, fee, covered, opening_hours, website, description,
    source, osm_type, osm_id, status)
VALUES (
    sqlc.arg(name),
    ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography,
    sqlc.narg(hoop_count), sqlc.arg(indoor), sqlc.narg(surface), sqlc.narg(lighting),
    sqlc.narg(access), sqlc.narg(fee), sqlc.narg(covered),
    sqlc.narg(opening_hours), sqlc.narg(website), sqlc.narg(description),
    'osm', sqlc.arg(osm_type), sqlc.arg(osm_id), 'pending'
)
ON CONFLICT (osm_type, osm_id) DO UPDATE SET
    name          = EXCLUDED.name,
    location      = EXCLUDED.location,
    hoop_count    = EXCLUDED.hoop_count,
    indoor        = EXCLUDED.indoor,
    surface       = EXCLUDED.surface,
    lighting      = EXCLUDED.lighting,
    access        = EXCLUDED.access,
    fee           = EXCLUDED.fee,
    covered       = EXCLUDED.covered,
    opening_hours = EXCLUDED.opening_hours,
    website       = EXCLUDED.website,
    description   = EXCLUDED.description,
    updated_at    = now()
RETURNING id, (xmax = 0) AS inserted;

-- Promotes and reports who submitted it (for the reputation award);
-- pgx.ErrNoRows means the court wasn't pending.
-- name: PromoteCourtIfPending :one
UPDATE courts SET status = 'verified', updated_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING submitted_by;

-- name: SetCourtStatus :exec
UPDATE courts SET status = $2, updated_at = now()
WHERE id = $1;

-- name: UpsertCourtVote :exec
INSERT INTO court_votes (court_id, user_id, vote)
VALUES ($1, $2, $3)
ON CONFLICT (court_id, user_id) DO UPDATE SET vote = EXCLUDED.vote;

-- name: CourtVoteStats :one
SELECT coalesce(sum(vote), 0)::int AS net_votes,
       coalesce(count(*) FILTER (WHERE vote = 1), 0)::int AS upvotes
FROM court_votes
WHERE court_id = $1;

-- name: CreateFlag :exec
INSERT INTO flags (user_id, entity_type, entity_id, reason)
VALUES ($1, $2, $3, $4);
