-- Phase 14: player-confirmed court conditions.

-- name: UpsertFactConfirmation :exec
-- One row per (court, user, fact): re-confirming refreshes the timestamp so
-- freshness reflects the latest visit, not the first.
INSERT INTO court_fact_confirmations (court_id, user_id, fact, value)
VALUES ($1, $2, $3, $4)
ON CONFLICT (court_id, user_id, fact)
DO UPDATE SET value = EXCLUDED.value, created_at = now();

-- name: CourtFactSummaries :many
-- Per-fact freshness for a court: how many players confirmed within the
-- window and when the latest confirmation happened.
SELECT fact,
       count(*)::int AS confirmations,
       max(created_at)::timestamptz AS last_confirmed_at,
       (mode() WITHIN GROUP (ORDER BY value))::text AS majority_value
FROM court_fact_confirmations
WHERE court_id = $1 AND created_at > now() - interval '90 days'
GROUP BY fact
ORDER BY fact;

-- name: CourtFactMajority :one
-- Majority value for one fact over the recent window (mode breaks ties
-- deterministically by value order).
SELECT mode() WITHIN GROUP (ORDER BY value)::text AS value
FROM court_fact_confirmations
WHERE court_id = $1 AND fact = $2 AND created_at > now() - interval '90 days';
