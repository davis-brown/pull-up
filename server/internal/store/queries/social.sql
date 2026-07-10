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

-- name: DeleteFollowsBetween :exec
DELETE FROM follows
WHERE (follower_id = $1 AND followee_id = $2)
   OR (follower_id = $2 AND followee_id = $1);
