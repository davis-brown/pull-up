-- name: CreateUser :one
INSERT INTO users (email, password_hash, display_name)
VALUES ($1, $2, $3)
RETURNING id, email, display_name, avatar_url, reputation, created_at, is_admin,
    is_private, jersey_number, position, height_cm, style_tags,
    (email_verified_at IS NOT NULL)::bool AS email_verified;

-- name: GetUserByEmail :one
SELECT id, email, password_hash, display_name, avatar_url, reputation, created_at,
    is_admin, is_private, jersey_number, position, height_cm, style_tags,
    (email_verified_at IS NOT NULL)::bool AS email_verified
FROM users
WHERE email = $1;

-- name: GetUserByID :one
SELECT id, email, display_name, avatar_url, reputation, created_at, is_admin,
    is_private, jersey_number, position, height_cm, style_tags,
    (email_verified_at IS NOT NULL)::bool AS email_verified
FROM users
WHERE id = $1;

-- name: UpdateUser :one
UPDATE users SET
    display_name   = coalesce(sqlc.narg('display_name'), display_name),
    avatar_url     = CASE WHEN sqlc.arg('avatar_url_set')::bool
                          THEN sqlc.narg('avatar_url')::text ELSE avatar_url END,
    is_private     = coalesce(sqlc.narg('is_private'), is_private),
    jersey_number  = CASE WHEN sqlc.arg('jersey_number_set')::bool
                          THEN sqlc.narg('jersey_number')::smallint ELSE jersey_number END,
    position       = CASE WHEN sqlc.arg('position_set')::bool
                          THEN sqlc.narg('position')::text ELSE position END,
    height_cm      = CASE WHEN sqlc.arg('height_cm_set')::bool
                          THEN sqlc.narg('height_cm')::smallint ELSE height_cm END,
    style_tags     = coalesce(sqlc.narg('style_tags')::text[], style_tags)
WHERE id = sqlc.arg('id')
RETURNING id, email, display_name, avatar_url, reputation, created_at, is_admin,
    is_private, jersey_number, position, height_cm, style_tags,
    (email_verified_at IS NOT NULL)::bool AS email_verified;

-- name: ClearUserAvatar :exec
UPDATE users SET avatar_url = NULL WHERE id = $1;

-- name: CreateRefreshToken :one
INSERT INTO refresh_tokens (user_id, family_id, token_hash, replaced_by_hash, expires_at)
VALUES ($1, $2, $3, sqlc.narg('replaced_by_hash'), $4)
RETURNING id;

-- name: GetRefreshTokenByHash :one
SELECT id, user_id, family_id, token_hash, expires_at, revoked_at, created_at
FROM refresh_tokens
WHERE token_hash = $1;

-- name: GetRefreshTokenByHashForUpdate :one
SELECT id, user_id, family_id, token_hash, expires_at, revoked_at, replaced_by_hash, created_at
FROM refresh_tokens
WHERE token_hash = $1
FOR UPDATE;

-- name: GetRefreshTokenReplacement :one
-- Returns the token that replaced a recently rotated one, if any.
SELECT id, user_id, family_id, token_hash, expires_at, revoked_at, replaced_by_hash, created_at
FROM refresh_tokens
WHERE token_hash = $1 AND revoked_at IS NULL;

-- name: RevokeRefreshToken :exec
UPDATE refresh_tokens SET revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL;

-- name: RevokeRefreshTokenFamily :exec
UPDATE refresh_tokens SET revoked_at = now()
WHERE family_id = $1 AND revoked_at IS NULL;

-- name: SetRefreshTokenReplacement :exec
UPDATE refresh_tokens
SET replaced_by_hash = $2
WHERE id = $1 AND replaced_by_hash IS NULL;

-- Email verification -------------------------------------------------------

-- name: CreateEmailVerificationToken :exec
INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
VALUES ($1, $2, $3);

-- name: GetUnverifiedPasswordUserByEmailForUpdate :one
SELECT id
FROM users
WHERE email = $1 AND auth_provider = 'password' AND email_verified_at IS NULL
FOR UPDATE;

-- name: InvalidateEmailVerificationTokens :exec
UPDATE email_verification_tokens
SET consumed_at = now()
WHERE user_id = $1 AND consumed_at IS NULL;

-- name: VerifyEmailWithToken :one
WITH consumed AS (
    UPDATE email_verification_tokens
    SET consumed_at = now()
    WHERE token_hash = $1
      AND consumed_at IS NULL
      AND expires_at > now()
    RETURNING user_id
), verified AS (
    UPDATE users u
    SET email_verified_at = now()
    FROM consumed c
    WHERE u.id = c.user_id
      AND u.auth_provider = 'password'
      AND u.email_verified_at IS NULL
    RETURNING u.id, u.email, u.display_name, u.avatar_url, u.reputation,
        u.created_at, u.is_admin, u.is_private, u.jersey_number, u.position,
        u.height_cm, u.style_tags
)
SELECT id, email, display_name, avatar_url, reputation, created_at, is_admin,
    is_private, jersey_number, position, height_cm, style_tags,
    true::bool AS email_verified
FROM verified;
