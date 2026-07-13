-- name: CourtsInBBox :many
SELECT
    c.id, c.name,
    ST_Y(c.location::geometry)::float8 AS lat,
    ST_X(c.location::geometry)::float8 AS lng,
    c.address, c.hoop_count, c.indoor, c.surface, c.lighting, c.is_public,
    c.drinking_water, c.toilets, c.parking, c.fenced,
    c.covered, c.fee, c.access,
    c.source, c.status,
    ac.active_count,
    lr.player_count AS latest_player_count,
    lr.run_quality  AS latest_run_quality,
    coalesce(lr.created_at, 'epoch'::timestamptz) AS latest_report_at
FROM courts c
LEFT JOIN LATERAL (
    SELECT coalesce(sum(ci.party_size), 0)::int AS active_count
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
  AND (sqlc.narg('indoor')::bool   IS NULL OR c.indoor = sqlc.narg('indoor'))
  AND (sqlc.narg('lit')::bool      IS NULL OR c.lighting = sqlc.narg('lit'))
  AND (sqlc.narg('has_hoops')::bool IS NULL OR (sqlc.narg('has_hoops') = false) OR c.hoop_count > 0)
  AND (sqlc.narg('public')::bool   IS NULL OR (sqlc.narg('public') = false) OR (c.is_public = true AND (c.access IS NULL OR c.access = 'public')))
  AND (sqlc.narg('free')::bool     IS NULL OR (sqlc.narg('free') = false) OR c.fee IS NULL OR c.fee = false)
  AND (sqlc.narg('covered')::bool  IS NULL OR c.covered = sqlc.narg('covered'))
  AND (sqlc.narg('surface')::text  IS NULL OR c.surface = sqlc.narg('surface'))
  AND (sqlc.narg('water')::bool    IS NULL OR (sqlc.narg('water') = false) OR c.drinking_water = true)
  AND (sqlc.narg('toilets')::bool  IS NULL OR (sqlc.narg('toilets') = false) OR c.toilets = true)
  AND (sqlc.narg('parking')::bool  IS NULL OR (sqlc.narg('parking') = false) OR c.parking = true)
  AND (sqlc.narg('fenced')::bool   IS NULL OR (sqlc.narg('fenced') = false) OR c.fenced = true)
  AND (sqlc.narg('min_hoops')::int IS NULL OR c.hoop_count >= sqlc.narg('min_hoops'))
LIMIT 200;

-- name: CourtsNearby :many
SELECT
    c.id, c.name,
    ST_Y(c.location::geometry)::float8 AS lat,
    ST_X(c.location::geometry)::float8 AS lng,
    c.address, c.hoop_count, c.indoor, c.surface, c.lighting, c.is_public,
    c.drinking_water, c.toilets, c.parking, c.fenced,
    c.covered, c.fee, c.access,
    c.source, c.status,
    ST_Distance(c.location, ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography)::float8 AS distance_m,
    ac.active_count,
    lr.player_count AS latest_player_count,
    lr.run_quality  AS latest_run_quality,
    coalesce(lr.created_at, 'epoch'::timestamptz) AS latest_report_at
FROM courts c
LEFT JOIN LATERAL (
    SELECT coalesce(sum(ci.party_size), 0)::int AS active_count
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
  AND (sqlc.narg('indoor')::bool   IS NULL OR c.indoor = sqlc.narg('indoor'))
  AND (sqlc.narg('lit')::bool      IS NULL OR c.lighting = sqlc.narg('lit'))
  AND (sqlc.narg('has_hoops')::bool IS NULL OR (sqlc.narg('has_hoops') = false) OR c.hoop_count > 0)
  AND (sqlc.narg('public')::bool   IS NULL OR (sqlc.narg('public') = false) OR (c.is_public = true AND (c.access IS NULL OR c.access = 'public')))
  AND (sqlc.narg('free')::bool     IS NULL OR (sqlc.narg('free') = false) OR c.fee IS NULL OR c.fee = false)
  AND (sqlc.narg('covered')::bool  IS NULL OR c.covered = sqlc.narg('covered'))
  AND (sqlc.narg('surface')::text  IS NULL OR c.surface = sqlc.narg('surface'))
  AND (sqlc.narg('water')::bool    IS NULL OR (sqlc.narg('water') = false) OR c.drinking_water = true)
  AND (sqlc.narg('toilets')::bool  IS NULL OR (sqlc.narg('toilets') = false) OR c.toilets = true)
  AND (sqlc.narg('parking')::bool  IS NULL OR (sqlc.narg('parking') = false) OR c.parking = true)
  AND (sqlc.narg('fenced')::bool   IS NULL OR (sqlc.narg('fenced') = false) OR c.fenced = true)
  AND (sqlc.narg('min_hoops')::int IS NULL OR c.hoop_count >= sqlc.narg('min_hoops'))
ORDER BY distance_m
LIMIT 100;

-- name: GetCourt :one
SELECT
    c.id, c.name,
    ST_Y(c.location::geometry)::float8 AS lat,
    ST_X(c.location::geometry)::float8 AS lng,
    c.address, c.hoop_count, c.indoor, c.surface, c.lighting, c.is_public,
    c.drinking_water, c.toilets, c.parking, c.fenced,
    c.access, c.fee, c.covered, c.opening_hours, c.website, c.description,
    c.source, c.osm_type, c.osm_id, c.status, c.submitted_by, c.created_at,
    c.enriched_at,
    ac.active_count,
    vs.net_votes
FROM courts c
LEFT JOIN LATERAL (
    SELECT coalesce(sum(ci.party_size), 0)::int AS active_count
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
    access, fee, covered, opening_hours, website, description, fenced,
    source, osm_type, osm_id, status)
VALUES (
    sqlc.arg(name),
    ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography,
    sqlc.narg(hoop_count), sqlc.arg(indoor), sqlc.narg(surface), sqlc.narg(lighting),
    sqlc.narg(access), sqlc.narg(fee), sqlc.narg(covered),
    sqlc.narg(opening_hours), sqlc.narg(website), sqlc.narg(description), sqlc.narg(fenced),
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
    fenced        = EXCLUDED.fenced,
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
-- The submitter's own vote (either direction) never counts toward their
-- court's verification tally.
SELECT coalesce(sum(v.vote), 0)::int AS net_votes,
       coalesce(count(*) FILTER (WHERE v.vote = 1), 0)::int AS upvotes
FROM court_votes v
JOIN courts c ON c.id = v.court_id
WHERE v.court_id = $1 AND (c.submitted_by IS NULL OR v.user_id <> c.submitted_by);

-- name: CreateFlag :exec
INSERT INTO flags (user_id, entity_type, entity_id, reason)
VALUES ($1, $2, $3, $4);

-- name: UpdateCourtAttributes :one
-- Structured crowd correction: each arg is coalesced so only provided fields change.
UPDATE courts SET
    surface        = coalesce(sqlc.narg('surface'), surface),
    lighting       = coalesce(sqlc.narg('lighting'), lighting),
    indoor         = coalesce(sqlc.narg('indoor'), indoor),
    covered        = coalesce(sqlc.narg('covered'), covered),
    hoop_count     = coalesce(sqlc.narg('hoop_count'), hoop_count),
    access         = coalesce(sqlc.narg('access'), access),
    fee            = coalesce(sqlc.narg('fee'), fee),
    drinking_water = coalesce(sqlc.narg('drinking_water'), drinking_water),
    toilets        = coalesce(sqlc.narg('toilets'), toilets),
    parking        = coalesce(sqlc.narg('parking'), parking),
    fenced         = coalesce(sqlc.narg('fenced'), fenced),
    updated_at     = now()
WHERE id = sqlc.arg('id')
RETURNING id;

-- name: InsertCourtAttributeEdit :exec
INSERT INTO court_attribute_edits (court_id, editor_id, field, old_value, new_value)
VALUES ($1, $2, $3, $4, $5);
