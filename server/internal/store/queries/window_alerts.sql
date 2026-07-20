-- Phase 16: your-window alerts ----------------------------------------------

-- name: ListWindowAlertCandidates :many
-- Favoriters of a court who could receive a your-window alert right now:
-- alerts enabled, availability windows and a timezone set, at least one push
-- token, not the acting player, not themselves active at this court, and
-- outside the 20-hour per-court cooldown (same cadence as check-in
-- reputation). Whether "now" actually falls inside one of the returned
-- windows is evaluated in Go against the user's timezone — see
-- api/window_alerts.go.
SELECT u.id AS user_id, u.availability, u.timezone,
       array_agg(DISTINCT pt.token)::text[] AS tokens
FROM users u
JOIN favorites f ON f.user_id = u.id AND f.court_id = sqlc.arg('court_id')
JOIN push_tokens pt ON pt.user_id = u.id
WHERE u.id <> sqlc.arg('actor')
  AND u.window_alerts_enabled
  AND u.timezone IS NOT NULL
  AND cardinality(u.availability) > 0
  AND NOT EXISTS (
      SELECT 1 FROM check_ins ci
      WHERE ci.user_id = u.id
        AND ci.court_id = sqlc.arg('court_id')
        AND ci.checked_out_at IS NULL
        AND ci.expires_at > now()
  )
  AND NOT EXISTS (
      SELECT 1 FROM window_alerts wa
      WHERE wa.user_id = u.id
        AND wa.court_id = sqlc.arg('court_id')
        AND wa.sent_at > now() - interval '20 hours'
  )
GROUP BY u.id;

-- name: RecordWindowAlert :exec
INSERT INTO window_alerts (user_id, court_id) VALUES ($1, $2);
