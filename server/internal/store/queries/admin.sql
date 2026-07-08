-- Admin management -----------------------------------------------------------

-- name: SearchUsers :many
SELECT id, email, display_name, reputation, is_admin, created_at
FROM users
WHERE email ILIKE '%' || sqlc.arg('query')::text || '%'
   OR display_name ILIKE '%' || sqlc.arg('query')::text || '%'
ORDER BY display_name
LIMIT 20;

-- name: CountAdmins :one
SELECT count(*)::int AS count FROM users WHERE is_admin;

-- name: SetUserAdmin :one
UPDATE users SET is_admin = $2
WHERE id = $1
RETURNING id, email, display_name, reputation, is_admin, created_at;

-- name: CreateAdminAction :exec
INSERT INTO admin_actions (actor_id, action, target_user_id)
VALUES ($1, $2, $3);

-- name: ListAdminActions :many
SELECT aa.id, aa.action, aa.created_at,
    actor.id AS actor_id, actor.display_name AS actor_name,
    target.id AS target_id, target.display_name AS target_name
FROM admin_actions aa
JOIN users actor ON actor.id = aa.actor_id
JOIN users target ON target.id = aa.target_user_id
ORDER BY aa.created_at DESC
LIMIT 50;
