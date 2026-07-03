-- name: CourtCheckInDistance :one
SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography)::float8 AS distance_m
FROM courts
WHERE id = sqlc.arg(court_id) AND status <> 'rejected';

-- name: CloseActiveCheckInsForUser :exec
UPDATE check_ins SET checked_out_at = now()
WHERE user_id = $1 AND checked_out_at IS NULL AND expires_at > now();

-- name: CreateCheckIn :one
INSERT INTO check_ins (court_id, user_id, source, reported_location, distance_m, expires_at)
VALUES (
    sqlc.arg(court_id), sqlc.arg(user_id), sqlc.arg(source),
    ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography,
    sqlc.arg(distance_m),
    now() + interval '2 hours'
)
RETURNING id, court_id, user_id, source, created_at, expires_at;

-- name: GetActiveCheckInForUser :one
SELECT ci.id, ci.court_id, c.name AS court_name, ci.source, ci.created_at, ci.expires_at
FROM check_ins ci
JOIN courts c ON c.id = ci.court_id
WHERE ci.user_id = $1 AND ci.checked_out_at IS NULL AND ci.expires_at > now()
ORDER BY ci.created_at DESC
LIMIT 1;

-- name: CountActiveCheckIns :one
SELECT count(*)::int AS active_count
FROM check_ins
WHERE court_id = $1 AND checked_out_at IS NULL AND expires_at > now();

-- name: ListActiveCheckIns :many
SELECT ci.id, ci.user_id, u.display_name, ci.source, ci.created_at, ci.expires_at
FROM check_ins ci
JOIN users u ON u.id = ci.user_id
WHERE ci.court_id = $1 AND ci.checked_out_at IS NULL AND ci.expires_at > now()
ORDER BY ci.created_at DESC;

-- name: CreateCrowdReport :one
INSERT INTO crowd_reports (court_id, user_id, player_count, run_quality, note)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, court_id, user_id, player_count, run_quality, note, created_at;

-- name: ListRecentReports :many
SELECT cr.id, cr.user_id, u.display_name, cr.player_count, cr.run_quality, cr.note, cr.created_at
FROM crowd_reports cr
JOIN users u ON u.id = cr.user_id
WHERE cr.court_id = $1 AND cr.created_at > now() - interval '2 hours'
ORDER BY cr.created_at DESC
LIMIT 20;
