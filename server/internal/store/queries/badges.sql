-- Phase 21b: badge earned-at tracking. Badges themselves stay derived
-- (deriveBadges in stats_handlers.go); these rows only record when each was
-- first observed and whether the player has been shown it.

-- name: ListUserBadges :many
SELECT slug, earned_at, seen_at FROM user_badges WHERE user_id = $1;

-- name: RecordUserBadges :many
-- Records newly-observed badges. seen decides whether they are celebrated:
-- the baseline sync passes true (everything already earned is old news),
-- every later call passes false so the badge gets its moment. ON CONFLICT
-- DO NOTHING keeps earned_at at the FIRST observation — re-recording an
-- existing badge must never reset its date or un-see it.
--
-- RETURNING carries the assigned earned_at back so the SAME response that
-- records a badge can report its date. Reading it beforehand cannot: the
-- row does not exist yet, which left earned_at null on exactly the request
-- that first earned the badge. Conflicting rows return nothing, which is
-- correct — their dates were already loaded by ListUserBadges.
INSERT INTO user_badges (user_id, slug, seen_at)
SELECT sqlc.arg('user_id'), unnest(sqlc.arg('slugs')::text[]),
       CASE WHEN sqlc.arg('seen')::bool THEN now() ELSE NULL END
ON CONFLICT (user_id, slug) DO NOTHING
RETURNING slug, earned_at;

-- name: MarkBadgesSeen :exec
UPDATE user_badges SET seen_at = now()
WHERE user_id = $1 AND seen_at IS NULL;

-- name: MarkBadgesSynced :exec
-- Stamps that this player's badge baseline has been taken, so subsequent
-- reads treat anything new as genuinely new.
UPDATE users SET badges_synced_at = now() WHERE id = $1 AND badges_synced_at IS NULL;

-- name: GetBadgesSyncedAt :one
SELECT badges_synced_at FROM users WHERE id = $1;
