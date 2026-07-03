-- name: CreateUser :one
INSERT INTO users (email, password_hash, display_name)
VALUES ($1, $2, $3)
RETURNING id, email, display_name, avatar_url, reputation, created_at;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, display_name, avatar_url, reputation, created_at
FROM users
WHERE email = $1;

-- name: GetUserByID :one
SELECT id, email, display_name, avatar_url, reputation, created_at
FROM users
WHERE id = $1;

-- name: UpdateUser :one
UPDATE users SET
    display_name = coalesce(sqlc.narg('display_name'), display_name),
    avatar_url   = coalesce(sqlc.narg('avatar_url'), avatar_url)
WHERE id = sqlc.arg('id')
RETURNING id, email, display_name, avatar_url, reputation, created_at;

-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
VALUES ($1, $2, $3)
RETURNING id;

-- name: GetRefreshTokenByHash :one
SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
FROM refresh_tokens
WHERE token_hash = $1;

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeAllUserRefreshTokens :exec
UPDATE refresh_tokens SET revoked_at = now()
WHERE user_id = $1 AND revoked_at IS NULL;
