-- name: CourtCheckInDistance :one
SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint(sqlc.arg(lng)::float8, sqlc.arg(lat)::float8), 4326)::geography)::float8 AS distance_m
FROM courts
WHERE id = sqlc.arg(court_id) AND status <> 'rejected';

-- name: CloseActiveCheckInsForUser :exec
UPDATE check_ins SET checked_out_at = now()
WHERE user_id = $1 AND checked_out_at IS NULL;

-- name: LockUserForCheckIn :one
SELECT id FROM users WHERE id = $1 FOR UPDATE;

-- name: CreateCheckIn :one
INSERT INTO check_ins (court_id, user_id, source, distance_m, expires_at, party_size, has_ball)
VALUES (
    sqlc.arg(court_id), sqlc.arg(user_id), sqlc.arg(source),
    sqlc.arg(distance_m),
    now() + interval '2 hours',
    sqlc.arg(party_size), sqlc.arg(has_ball)
)
RETURNING id, court_id, user_id, source, created_at, expires_at, party_size, has_ball;

-- name: GetActiveCheckInForUser :one
SELECT ci.id, ci.court_id, c.name AS court_name, ci.source, ci.created_at, ci.expires_at
FROM check_ins ci
JOIN courts c ON c.id = ci.court_id
WHERE ci.user_id = $1 AND ci.checked_out_at IS NULL AND ci.expires_at > now()
ORDER BY ci.created_at DESC
LIMIT 1;

-- name: CountActiveCheckIns :one
SELECT coalesce(sum(party_size), 0)::int AS active_count
FROM check_ins
WHERE court_id = $1 AND checked_out_at IS NULL AND expires_at > now();

-- Row count, not a headcount: "was this the check-in that started the run?"
-- is a question about check-in rows (1 = the court was empty before it), while
-- displayed headcounts sum party_size.
-- name: CountActiveCheckInRows :one
SELECT count(*)::int AS row_count
FROM check_ins
WHERE court_id = $1 AND checked_out_at IS NULL AND expires_at > now();

-- name: ListActiveCheckIns :many
SELECT ci.id, ci.user_id, u.display_name, ci.source, ci.created_at, ci.expires_at, ci.party_size, ci.has_ball
FROM check_ins ci
JOIN users u ON u.id = ci.user_id
WHERE ci.court_id = sqlc.arg(court_id)
  AND ci.checked_out_at IS NULL AND ci.expires_at > now()
  AND sqlc.arg(viewer_id)::uuid <> '00000000-0000-0000-0000-000000000000'::uuid
  AND EXISTS (SELECT 1 FROM users viewer WHERE viewer.id = sqlc.arg(viewer_id))
  AND (
      ci.user_id = sqlc.arg(viewer_id)
      OR NOT u.is_private
      OR EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = sqlc.arg(viewer_id) AND f.followee_id = ci.user_id
      )
  )
  AND NOT EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE (b.blocker_id = sqlc.arg(viewer_id) AND b.blocked_id = ci.user_id)
         OR (b.blocker_id = ci.user_id AND b.blocked_id = sqlc.arg(viewer_id))
  )
ORDER BY ci.created_at DESC;

-- name: CreateCrowdReport :one
INSERT INTO crowd_reports (court_id, user_id, player_count, run_quality, note)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, court_id, user_id, player_count, run_quality, note, created_at;

-- viewer_id (zero UUID for anonymous) hides reports from blocked users.
-- name: ListRecentReports :many
SELECT cr.id, cr.user_id, u.display_name, cr.player_count, cr.run_quality, cr.note, cr.created_at
FROM crowd_reports cr
JOIN users u ON u.id = cr.user_id
WHERE cr.court_id = sqlc.arg(court_id) AND cr.created_at > now() - interval '2 hours'
  AND NOT EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE b.blocker_id = sqlc.arg(viewer_id) AND b.blocked_id = cr.user_id
  )
ORDER BY cr.created_at DESC
LIMIT 20;
