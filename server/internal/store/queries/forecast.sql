-- Task 5: hourly turnout forecast. Powers a client-side time scrubber that
-- fetches per-court hourly expected headcounts once and scrubs locally.

-- name: CourtHourlyCheckInHistory :many
-- Buckets by check-in start hour in the caller's local offset; a cheap proxy
-- for concurrency that only needs the check_ins table.
SELECT ci.court_id,
       EXTRACT(HOUR FROM (ci.created_at + (sqlc.arg(tz_offset_minutes)::int * interval '1 minute')))::int AS local_hour,
       coalesce(sum(ci.party_size), 0)::int AS total_heads
FROM check_ins ci
WHERE ci.court_id = ANY(sqlc.arg(court_ids)::uuid[])
  AND ci.created_at > now() - interval '56 days'
  AND EXTRACT(DOW FROM (ci.created_at + (sqlc.arg(tz_offset_minutes)::int * interval '1 minute'))) = sqlc.arg(dow)::int
GROUP BY ci.court_id, local_hour;

-- name: CourtSessionsForDay :many
SELECT s.id, s.court_id, s.starts_at,
       count(r.user_id) FILTER (WHERE r.status = 'going')::int AS going
FROM sessions s
LEFT JOIN session_rsvps r ON r.session_id = s.id
WHERE s.court_id = ANY(sqlc.arg(court_ids)::uuid[])
  AND s.canceled_at IS NULL
  AND s.starts_at >= sqlc.arg(day_start)::timestamptz
  AND s.starts_at <  sqlc.arg(day_end)::timestamptz
GROUP BY s.id;
