-- Phase 20: XP, levels, and the streak nudge -------------------------------

-- name: AwardXP :one
-- Idempotent, capped XP award in one statement. The dedup_key (built by
-- the awarding site: check-in id, session id, court id, day, week…) makes
-- a repeat call a no-op, so retries and double-fires can't inflate a
-- level. The daily cap clamps the award to whatever budget is left today;
-- "today" is the UTC server day — the cap is a coarse anti-farming guard,
-- not a user-facing promise, so it deliberately doesn't chase per-user
-- timezones. Returns the points actually awarded (0 when deduped or
-- capped out) and the user's resulting total, letting the caller detect a
-- level crossing without a second read.
WITH used AS (
    SELECT coalesce(sum(points), 0)::int AS today
    FROM xp_events
    WHERE xp_events.user_id = sqlc.arg('user_id')
      AND xp_events.created_at >= date_trunc('day', now())
), allowed AS (
    SELECT LEAST(sqlc.arg('points')::int,
                 GREATEST(0, sqlc.arg('daily_cap')::int - used.today))::int AS points
    FROM used
), ins AS (
    INSERT INTO xp_events (user_id, kind, points, dedup_key)
    SELECT sqlc.arg('user_id'), sqlc.arg('kind'), allowed.points, sqlc.arg('dedup_key')
    FROM allowed WHERE allowed.points > 0
    ON CONFLICT (user_id, dedup_key) DO NOTHING
    RETURNING points
), bumped AS (
    UPDATE users
    SET xp = xp + (SELECT coalesce(sum(points), 0)::int FROM ins)
    WHERE id = sqlc.arg('user_id')
    RETURNING xp
)
SELECT (SELECT coalesce(sum(points), 0)::int FROM ins) AS awarded,
       (SELECT xp FROM bumped) AS total_xp;

-- name: GetUserXP :one
-- Both halves of the player card's XP state in one read: the cached
-- lifetime total, and any level crossing not yet shown to the player.
SELECT xp, level_up_pending FROM users WHERE id = $1;

-- name: FindAttendedSessionForCheckIn :one
-- The run this check-in counts as showing up to: a session at this court
-- that the player RSVP'd "going" to, starting within a couple of hours
-- either side of now (the same +/-2h grace the RSVP and nearby-runs
-- queries already use for "this run is happening").
SELECT s.id
FROM sessions s
JOIN session_rsvps r ON r.session_id = s.id
WHERE s.court_id = sqlc.arg('court_id')
  AND r.user_id = sqlc.arg('user_id')
  AND r.status = 'going'
  AND s.canceled_at IS NULL
  AND s.starts_at > now() - interval '2 hours'
  AND s.starts_at < now() + interval '2 hours'
ORDER BY s.starts_at
LIMIT 1;

-- name: ListStreakNudgeCandidates :many
-- Users whose week streak is alive but at risk: they checked in during
-- the PREVIOUS week (so a streak genuinely exists) and not yet during the
-- current one. Only users who can and want to hear about it — nudges on,
-- a push token, and a timezone on file (phase 16; users without one are
-- skipped rather than guessed at) — and not nudged in the last 6 days.
-- The caller re-checks each candidate's local hour and computes the exact
-- streak length with the existing weekStreak helper.
SELECT u.id AS user_id, u.timezone
FROM users u
WHERE u.play_nudges_enabled
  AND u.timezone IS NOT NULL
  AND (u.last_play_nudge_at IS NULL OR u.last_play_nudge_at < now() - interval '6 days')
  AND EXISTS (SELECT 1 FROM push_tokens pt WHERE pt.user_id = u.id)
  AND EXISTS (
      SELECT 1 FROM check_ins ci
      WHERE ci.user_id = u.id
        AND ci.created_at >= date_trunc('week', now()) - interval '7 days'
        AND ci.created_at < date_trunc('week', now())
  )
  AND NOT EXISTS (
      SELECT 1 FROM check_ins ci
      WHERE ci.user_id = u.id AND ci.created_at >= date_trunc('week', now())
  )
LIMIT sqlc.arg('max_candidates');

-- name: MarkPlayNudgeSent :exec
UPDATE users SET last_play_nudge_at = now() WHERE id = $1;

-- Phase 21: XP legibility --------------------------------------------------

-- name: XPBreakdownSince :many
-- What a player's recent XP is actually made of, grouped by award kind.
-- Reads the xp_events ledger directly (phase 20 wrote it but never read
-- it); xp_events_user_created_idx covers this exactly. Kinds with no
-- events in the window are simply absent — the client renders the fixed
-- list and fills in zeros, so a new award kind never needs a migration
-- here.
SELECT kind,
       sum(points)::int AS points,
       count(*)::int    AS events
FROM xp_events
WHERE user_id = sqlc.arg('user_id')
  AND created_at >= sqlc.arg('since')
GROUP BY kind
ORDER BY points DESC, kind;

-- name: MarkLevelUpPending :exec
-- Records a level crossing for a player who can't be told about it in the
-- response that caused it (awardCheckInXP runs off the request path).
-- GREATEST keeps the highest unseen level when two crossings land before
-- the player opens the app, so a double level-up celebrates the level they
-- actually reached rather than the first one.
UPDATE users
SET level_up_pending = GREATEST(coalesce(level_up_pending, 0), sqlc.arg('level')::int)
WHERE id = sqlc.arg('user_id');

-- name: AckLevelUp :exec
UPDATE users SET level_up_pending = NULL WHERE id = $1;

-- name: XPSince :one
-- Total XP earned in a window — the season total. Deliberately summed live
-- rather than cached: xp_events_user_created_idx covers it, it is one row
-- per profile load, and a cached per-season counter would be a second
-- source of truth to keep correct across backfills and season rollovers.
SELECT coalesce(sum(points), 0)::int AS xp
FROM xp_events
WHERE user_id = sqlc.arg('user_id') AND created_at >= sqlc.arg('since');
