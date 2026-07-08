-- Account deletion and user blocking (App Store 5.1.1(v) / UGC policies).

-- Courts outlive their submitter; flags keep their resolution but lose the
-- resolver attribution. Everything else cascades from the users row.
-- name: DetachUserFromCourts :exec
UPDATE courts SET submitted_by = NULL WHERE submitted_by = $1;

-- name: DetachUserFromResolvedFlags :exec
UPDATE flags SET resolved_by = NULL WHERE resolved_by = $1;

-- name: DeleteUser :execrows
DELETE FROM users WHERE id = $1;

-- name: BlockUser :exec
INSERT INTO blocked_users (blocker_id, blocked_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: UnblockUser :exec
DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2;

-- name: ListBlockedUsers :many
SELECT b.blocked_id, u.display_name, b.created_at
FROM blocked_users b
JOIN users u ON u.id = b.blocked_id
WHERE b.blocker_id = $1
ORDER BY b.created_at DESC;
