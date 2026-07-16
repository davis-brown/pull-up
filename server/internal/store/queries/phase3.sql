-- Phase 3: planned sessions + RSVPs, court chat, reputation weighting.

-- name: CreateSession :one
INSERT INTO sessions (court_id, created_by, starts_at, note)
VALUES ($1, $2, $3, $4)
RETURNING id, court_id, created_by, starts_at, note, created_at;

-- name: GetSession :one
SELECT s.id, s.court_id, c.name AS court_name, s.created_by, s.starts_at, s.note, s.canceled_at, s.created_at
FROM sessions s
JOIN courts c ON c.id = s.court_id
WHERE s.id = $1;

-- Upcoming (and just-started) runs for a court, with the going-count and the
-- viewer's own RSVP. viewer_id may be the zero UUID for anonymous requests.
-- name: ListUpcomingSessions :many
SELECT
    s.id, s.court_id, s.created_by, u.display_name AS created_by_name,
    s.starts_at, s.note, s.created_at,
    g.going_count,
    coalesce(mine.status, '') AS my_rsvp
FROM sessions s
JOIN users u ON u.id = s.created_by
LEFT JOIN LATERAL (
    SELECT count(*)::int AS going_count
    FROM session_rsvps r
    WHERE r.session_id = s.id AND r.status = 'going'
) g ON true
LEFT JOIN session_rsvps mine
    ON mine.session_id = s.id AND mine.user_id = sqlc.arg(viewer_id)
WHERE s.court_id = sqlc.arg(court_id)
  AND s.canceled_at IS NULL
  AND s.starts_at > now() - interval '2 hours'
  AND NOT EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE b.blocker_id = sqlc.arg(viewer_id) AND b.blocked_id = s.created_by
  )
ORDER BY s.starts_at
LIMIT 20;

-- name: CancelSession :execrows
UPDATE sessions SET canceled_at = now()
WHERE id = $1 AND created_by = $2 AND canceled_at IS NULL;

-- name: UpsertRSVP :exec
INSERT INTO session_rsvps (session_id, user_id, status)
VALUES ($1, $2, $3)
ON CONFLICT (session_id, user_id) DO UPDATE SET status = EXCLUDED.status, updated_at = now();

-- name: ListSessionAttendees :many
SELECT r.user_id, u.display_name, r.created_at
FROM session_rsvps r
JOIN users u ON u.id = r.user_id
WHERE r.session_id = sqlc.arg(session_id) AND r.status = 'going'
  AND sqlc.arg(viewer_id)::uuid <> '00000000-0000-0000-0000-000000000000'::uuid
  AND EXISTS (SELECT 1 FROM users viewer WHERE viewer.id = sqlc.arg(viewer_id))
  AND (
      r.user_id = sqlc.arg(viewer_id)
      OR NOT u.is_private
      OR EXISTS (
          SELECT 1 FROM follows f
          WHERE f.follower_id = sqlc.arg(viewer_id) AND f.followee_id = r.user_id
      )
  )
  AND NOT EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE (b.blocker_id = sqlc.arg(viewer_id) AND b.blocked_id = r.user_id)
         OR (b.blocker_id = r.user_id AND b.blocked_id = sqlc.arg(viewer_id))
  )
ORDER BY r.created_at
LIMIT 50;

-- name: CountSessionAttendees :one
SELECT count(*)::int AS going_count
FROM session_rsvps
WHERE session_id = $1 AND status = 'going';

-- name: CreateCourtMessage :one
INSERT INTO court_messages (court_id, user_id, body)
VALUES (sqlc.arg(court_id), sqlc.arg(user_id), sqlc.arg(body))
RETURNING id, court_id, user_id,
    (SELECT display_name FROM users WHERE id = sqlc.arg(user_id)) AS display_name,
    body, created_at;

-- Latest 50 visible messages, newest first (client reverses for display).
-- viewer_id (zero UUID for anonymous) hides users the viewer has blocked.
-- name: ListCourtMessages :many
SELECT m.id, m.court_id, m.user_id, u.display_name, m.body, m.created_at
FROM court_messages m
JOIN users u ON u.id = m.user_id
WHERE m.court_id = sqlc.arg(court_id) AND m.hidden_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE b.blocker_id = sqlc.arg(viewer_id) AND b.blocked_id = m.user_id
  )
ORDER BY m.created_at DESC
LIMIT 50;

-- Server-side chat rate limit: when did this user last post anywhere?
-- name: LastMessageAt :one
SELECT coalesce(max(created_at), 'epoch'::timestamptz)::timestamptz AS last_at
FROM court_messages
WHERE user_id = $1;

-- name: SetMessageHidden :execrows
UPDATE court_messages
SET hidden_at = CASE WHEN sqlc.arg(hidden)::bool THEN now() ELSE NULL END
WHERE id = sqlc.arg(id);

-- name: AddReputation :exec
UPDATE users SET reputation = reputation + $2 WHERE id = $1;

-- Reputation-weighted vote tally. Weight tiers: <50 rep = 1, 50-99 = 2,
-- 100+ = 3 — experienced players' votes count more, capped so no one
-- becomes a one-person verdict beyond 3x. The submitter's own vote (either
-- direction) never counts toward their court's verification tally.
-- name: CourtVoteStatsWeighted :one
SELECT
    coalesce(sum(v.vote * w.weight), 0)::int AS net_weighted,
    coalesce(sum(w.weight) FILTER (WHERE v.vote = 1), 0)::int AS weighted_upvotes
FROM court_votes v
JOIN courts c ON c.id = v.court_id
JOIN LATERAL (
    SELECT 1 + LEAST(u.reputation, 100) / 50 AS weight
    FROM users u WHERE u.id = v.user_id
) w ON true
WHERE v.court_id = $1 AND (c.submitted_by IS NULL OR v.user_id <> c.submitted_by);

-- Anti-farming guard: reputation for a check-in is only awarded once per
-- court per 20 hours. exclude_id is the check-in just created.
-- name: HasRecentCheckInAtCourt :one
SELECT EXISTS (
    SELECT 1 FROM check_ins
    WHERE user_id = sqlc.arg(user_id)
      AND court_id = sqlc.arg(court_id)
      AND id <> sqlc.arg(exclude_id)
      AND created_at > now() - interval '20 hours'
)::bool AS recent;
