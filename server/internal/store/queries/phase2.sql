-- Photos ------------------------------------------------------------------

-- name: CreateCourtPhoto :one
INSERT INTO court_photos (court_id, user_id, storage_key, status)
VALUES ($1, $2, $3, 'pending')
RETURNING id, court_id, user_id, storage_key, status, created_at;

-- name: ListCourtPhotos :many
SELECT id, user_id, storage_key, created_at
FROM court_photos
WHERE court_id = $1 AND status = 'visible'
ORDER BY created_at DESC
LIMIT 20;

-- Removed objects are physically deleted asynchronously and cannot later be
-- restored to a visible metadata state.
-- name: SetPhotoStatus :execrows
UPDATE court_photos SET status = $2
WHERE id = $1 AND NOT (status = 'removed' AND $2 <> 'removed');

-- Favorites ---------------------------------------------------------------

-- name: AddFavorite :exec
INSERT INTO favorites (user_id, court_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: RemoveFavorite :exec
DELETE FROM favorites WHERE user_id = $1 AND court_id = $2;

-- name: IsFavorite :one
SELECT EXISTS (
    SELECT 1 FROM favorites WHERE user_id = $1 AND court_id = $2
) AS is_favorite;

-- name: ListFavoriteCourts :many
SELECT c.id, c.name,
    ST_Y(c.location::geometry)::float8 AS lat,
    ST_X(c.location::geometry)::float8 AS lng,
    c.indoor, c.status,
    ac.active_count
FROM favorites f
JOIN courts c ON c.id = f.court_id
LEFT JOIN LATERAL (
    SELECT coalesce(sum(ci.party_size), 0)::int AS active_count
    FROM check_ins ci
    WHERE ci.court_id = c.id AND ci.checked_out_at IS NULL AND ci.expires_at > now()
) ac ON true
WHERE f.user_id = $1 AND c.status <> 'rejected'
ORDER BY f.created_at DESC;

-- Push tokens ---------------------------------------------------------------

-- name: UpsertPushToken :exec
INSERT INTO push_tokens (token, user_id)
VALUES ($1, $2)
ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = now();

-- name: DeletePushToken :execrows
DELETE FROM push_tokens WHERE token = $1 AND user_id = $2;

-- name: ListFavoriterPushTokens :many
-- Tokens of everyone who favorited the court, except the acting user.
SELECT DISTINCT pt.token
FROM push_tokens pt
JOIN favorites f ON f.user_id = pt.user_id
WHERE f.court_id = $1 AND pt.user_id <> $2;

-- name: ListSessionNotifyTokens :many
-- Push tokens to notify about a planned run: the court's favoriters plus the
-- planner's followers, excluding the planner. Deduped by DISTINCT token.
SELECT DISTINCT pt.token
FROM push_tokens pt
WHERE pt.user_id <> sqlc.arg('actor')
  AND (
    pt.user_id IN (SELECT user_id FROM favorites WHERE court_id = sqlc.arg('court_id'))
    OR pt.user_id IN (SELECT follower_id FROM follows WHERE followee_id = sqlc.arg('actor'))
  );

-- name: ListUserPushTokens :many
SELECT token FROM push_tokens WHERE user_id = $1;

-- OAuth ---------------------------------------------------------------------

-- name: GetUserByOAuth :one
SELECT id, email, display_name, avatar_url, reputation, created_at, is_admin,
    is_private, (email_verified_at IS NOT NULL)::bool AS email_verified
FROM users
WHERE auth_provider = $1 AND oauth_subject = $2;

-- name: CreateOAuthUser :one
INSERT INTO users (email, display_name, auth_provider, oauth_subject, email_verified_at)
VALUES ($1, $2, $3, $4, now())
RETURNING id, email, display_name, avatar_url, reputation, created_at, is_admin,
    is_private, true::bool AS email_verified;

-- Check-in history ------------------------------------------------------------

-- name: ListUserCheckInHistory :many
SELECT ci.id, ci.court_id, c.name AS court_name, ci.source, ci.created_at, ci.checked_out_at, ci.expires_at
FROM check_ins ci
JOIN courts c ON c.id = ci.court_id
WHERE ci.user_id = $1
ORDER BY ci.created_at DESC
LIMIT 50;

-- Moderation ------------------------------------------------------------------

-- name: GetUserAdmin :one
SELECT is_admin FROM users WHERE id = $1;

-- name: ListOpenFlags :many
SELECT fl.id, fl.user_id, u.display_name AS reporter, fl.entity_type, fl.entity_id, fl.reason, fl.created_at
FROM flags fl
JOIN users u ON u.id = fl.user_id
WHERE fl.resolved_at IS NULL
ORDER BY fl.created_at ASC
LIMIT 100;

-- name: ResolveFlag :exec
UPDATE flags SET resolved_at = now(), resolved_by = $2
WHERE id = $1 AND resolved_at IS NULL;
