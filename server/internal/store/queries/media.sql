-- Owned-media authorization and asynchronous R2 deletion queue.

-- name: IsMediaKeyAuthorized :one
SELECT EXISTS (
    SELECT 1 FROM users WHERE avatar_url = '/photos/' || sqlc.arg(storage_key)::text
    UNION ALL
    SELECT 1 FROM court_photos
    WHERE storage_key = sqlc.arg(storage_key) AND status = 'visible'
)::bool AS authorized;

-- name: ClaimObjectDeletions :many
WITH candidates AS (
    SELECT q.storage_key
    FROM object_deletion_queue q
    WHERE q.requested_at <= now()
      AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '5 minutes')
      AND NOT EXISTS (
          SELECT 1 FROM users u WHERE u.avatar_url = '/photos/' || q.storage_key
      )
      AND NOT EXISTS (
          SELECT 1 FROM court_photos p
          WHERE p.storage_key = q.storage_key AND p.status = 'visible'
      )
    ORDER BY q.requested_at
    FOR UPDATE SKIP LOCKED
    LIMIT sqlc.arg(batch_size)
)
UPDATE object_deletion_queue q
SET claimed_at = now(), attempts = q.attempts + 1
FROM candidates c
WHERE q.storage_key = c.storage_key
RETURNING q.storage_key;

-- name: AckObjectDeletions :execrows
DELETE FROM object_deletion_queue
WHERE storage_key = ANY(sqlc.arg(storage_keys)::text[]);

-- name: MarkCourtPhotoUploaded :execrows
UPDATE court_photos
SET status = 'visible'
WHERE storage_key = $1 AND status IN ('pending', 'visible');

-- name: ScheduleUploadedObjectCleanup :exec
INSERT INTO object_deletion_queue (storage_key, requested_at)
VALUES ($1, now() + interval '1 hour')
ON CONFLICT (storage_key) DO NOTHING;
