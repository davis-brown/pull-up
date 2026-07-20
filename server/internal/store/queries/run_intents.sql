-- Phase 19: looking-for-a-run ------------------------------------------------

-- name: UpsertRunIntent :execrows
-- Idempotent join: a second tap on an already-held bucket is a no-op, not
-- an error.
INSERT INTO run_intents (court_id, user_id, run_date, window_key)
VALUES (sqlc.arg('court_id'), sqlc.arg('user_id'), sqlc.arg('run_date'), sqlc.arg('window_key'))
ON CONFLICT DO NOTHING;

-- name: WithdrawRunIntent :execrows
DELETE FROM run_intents
WHERE court_id = sqlc.arg('court_id') AND user_id = sqlc.arg('user_id')
  AND run_date = sqlc.arg('run_date') AND window_key = sqlc.arg('window_key');

-- name: ListRunIntentsForCourt :many
-- Every seeker at every bucket for this court from today forward; the
-- caller (Go) drops same-day buckets whose window has already ended, since
-- that needs the window-span hour table this file has no access to.
SELECT ri.run_date, ri.window_key, ri.user_id,
    u.display_name, u.avatar_url, u.skill_level
FROM run_intents ri
JOIN users u ON u.id = ri.user_id
WHERE ri.court_id = sqlc.arg('court_id')
  AND ri.run_date >= (now() AT TIME ZONE 'UTC')::date
ORDER BY ri.run_date, ri.window_key, ri.created_at;

-- name: CountRunIntentBucket :one
SELECT count(*)::int FROM run_intents
WHERE court_id = sqlc.arg('court_id') AND run_date = sqlc.arg('run_date') AND window_key = sqlc.arg('window_key');

-- name: ListRunIntentBucketTokens :many
-- Push tokens of everyone in a bucket, optionally excluding one user (the
-- session planner, on the conversion push).
SELECT DISTINCT pt.token
FROM run_intents ri
JOIN push_tokens pt ON pt.user_id = ri.user_id
WHERE ri.court_id = sqlc.arg('court_id') AND ri.run_date = sqlc.arg('run_date') AND ri.window_key = sqlc.arg('window_key')
  AND ri.user_id <> sqlc.arg('exclude_user_id');

-- name: MarkRunIntentThresholdAlerted :execrows
-- Fire-once gate: a row only flips from NULL to now() the first time this
-- runs for a bucket, so the caller can tell whether IT won the race to
-- send the threshold push (rows affected = 1) or another request already
-- did (0).
INSERT INTO run_intent_bucket_events (court_id, run_date, window_key, threshold_alerted_at)
VALUES (sqlc.arg('court_id'), sqlc.arg('run_date'), sqlc.arg('window_key'), now())
ON CONFLICT (court_id, run_date, window_key) DO UPDATE
    SET threshold_alerted_at = now()
    WHERE run_intent_bucket_events.threshold_alerted_at IS NULL;

-- name: MarkRunIntentConverted :execrows
-- Same fire-once gate, for the "a run was planned in your window" push.
INSERT INTO run_intent_bucket_events (court_id, run_date, window_key, converted_at)
VALUES (sqlc.arg('court_id'), sqlc.arg('run_date'), sqlc.arg('window_key'), now())
ON CONFLICT (court_id, run_date, window_key) DO UPDATE
    SET converted_at = now()
    WHERE run_intent_bucket_events.converted_at IS NULL;
