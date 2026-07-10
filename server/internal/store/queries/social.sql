-- Follow graph and profile aggregates.

-- name: Follow :exec
INSERT INTO follows (follower_id, followee_id)
VALUES (sqlc.arg('follower_id'), sqlc.arg('followee_id'))
ON CONFLICT DO NOTHING;

-- name: Unfollow :exec
DELETE FROM follows
WHERE follower_id = sqlc.arg('follower_id') AND followee_id = sqlc.arg('followee_id');

-- name: IsFollowing :one
SELECT EXISTS (
    SELECT 1 FROM follows
    WHERE follower_id = sqlc.arg('follower_id') AND followee_id = sqlc.arg('followee_id')
)::bool AS following;

-- name: CountFollowers :one
SELECT count(*)::int AS count FROM follows WHERE followee_id = $1;

-- name: CountFollowing :one
SELECT count(*)::int AS count FROM follows WHERE follower_id = $1;

-- name: ListFollowers :many
SELECT u.id, u.display_name, u.avatar_url, f.created_at
FROM follows f
JOIN users u ON u.id = f.follower_id
WHERE f.followee_id = $1
ORDER BY f.created_at DESC
LIMIT $2;

-- name: ListFollowing :many
SELECT u.id, u.display_name, u.avatar_url, f.created_at
FROM follows f
JOIN users u ON u.id = f.followee_id
WHERE f.follower_id = $1
ORDER BY f.created_at DESC
LIMIT $2;

-- name: AreBlocked :one
SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = $1 AND blocked_id = $2)
       OR (blocker_id = $2 AND blocked_id = $1)
)::bool AS blocked;

-- name: DeleteFollowsBetween :exec
DELETE FROM follows
WHERE (follower_id = $1 AND followee_id = $2)
   OR (follower_id = $2 AND followee_id = $1);

-- name: GetProfileStats :one
SELECT
    u.id, u.display_name, u.avatar_url, u.reputation, u.created_at AS member_since,
    (SELECT count(*) FROM check_ins ci WHERE ci.user_id = u.id)::int AS check_in_count,
    (SELECT count(*) FROM courts c WHERE c.submitted_by = u.id AND c.status = 'verified')::int AS courts_added_count,
    (SELECT count(*) FROM follows f WHERE f.followee_id = u.id)::int AS follower_count,
    (SELECT count(*) FROM follows f WHERE f.follower_id = u.id)::int AS following_count
FROM users u
WHERE u.id = $1;

-- name: CurrentStreakDays :one
-- Consecutive UTC days ending today or yesterday with >=1 geo-verified
-- check-in. Distinct check-in days are numbered densely from the most recent;
-- a day is in the streak when its offset-from-today, re-based against the most
-- recent check-in day's offset (the anchor), equals its dense rank. The anchor
-- must be today (0) or yesterday (1), else the streak has lapsed (0).
WITH days AS (
    SELECT DISTINCT (date_trunc('day', created_at AT TIME ZONE 'UTC'))::date AS d
    FROM check_ins
    WHERE user_id = $1
), ranked AS (
    SELECT d,
        ((now() AT TIME ZONE 'UTC')::date - d) AS offset_days,
        row_number() OVER (ORDER BY d DESC) - 1 AS rn
    FROM days
)
SELECT count(*)::int AS streak_days
FROM ranked
WHERE offset_days - (SELECT min(offset_days) FROM ranked) = rn
  AND (SELECT min(offset_days) FROM ranked) <= 1;
