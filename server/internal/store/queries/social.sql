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

-- name: ListFriendsCheckedIn :many
-- Mutual-follow friends with an active check-in right now. "Friends" = a follows
-- row in both directions. Excludes the viewer and any blocked pair. This is the
-- only place a user's live court + check-in time is exposed, and only under
-- mutual follow (the phase-7 consent rule).
SELECT
    u.id, u.display_name, u.avatar_url,
    ci.court_id, c.name AS court_name,
    ci.created_at AS since
FROM check_ins ci
JOIN users u ON u.id = ci.user_id
JOIN courts c ON c.id = ci.court_id
WHERE ci.checked_out_at IS NULL
  AND ci.expires_at > now()
  AND ci.user_id <> sqlc.arg('viewer_id')
  AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = sqlc.arg('viewer_id') AND f.followee_id = ci.user_id)
  AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ci.user_id AND f.followee_id = sqlc.arg('viewer_id'))
  AND NOT EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE (b.blocker_id = sqlc.arg('viewer_id') AND b.blocked_id = ci.user_id)
         OR (b.blocker_id = ci.user_id AND b.blocked_id = sqlc.arg('viewer_id'))
  )
ORDER BY ci.created_at DESC
LIMIT 50;

-- name: ListFeedRuns :many
-- Upcoming runs for the viewer's feed: future, non-canceled sessions planned by
-- someone the viewer follows OR at a court the viewer favorited. Excludes the
-- viewer's own runs and blocked planners; deduped by session; soonest first.
SELECT
    s.id, s.court_id, c.name AS court_name,
    s.created_by, u.display_name AS created_by_name,
    s.starts_at, s.note, s.created_at,
    g.going_count,
    coalesce(mine.status, '') AS my_rsvp
FROM sessions s
JOIN users u ON u.id = s.created_by
JOIN courts c ON c.id = s.court_id
LEFT JOIN LATERAL (
    SELECT count(*)::int AS going_count
    FROM session_rsvps r
    WHERE r.session_id = s.id AND r.status = 'going'
) g ON true
LEFT JOIN session_rsvps mine
    ON mine.session_id = s.id AND mine.user_id = sqlc.arg('viewer_id')
WHERE s.canceled_at IS NULL
  AND s.starts_at > now() - interval '2 hours'
  AND s.starts_at < now() + interval '7 days'
  AND s.created_by <> sqlc.arg('viewer_id')
  AND (
      s.created_by IN (SELECT followee_id FROM follows WHERE follower_id = sqlc.arg('viewer_id'))
      OR s.court_id IN (SELECT court_id FROM favorites WHERE user_id = sqlc.arg('viewer_id'))
  )
  AND NOT EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE b.blocker_id = sqlc.arg('viewer_id') AND b.blocked_id = s.created_by
  )
ORDER BY s.starts_at
LIMIT 50;
