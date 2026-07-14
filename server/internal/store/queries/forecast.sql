-- Task 5: hourly turnout forecast. Powers a client-side time scrubber that
-- fetches per-court hourly expected headcounts once and scrubs locally.

-- name: CourtHourlyCheckInHistory :many
-- Buckets each check-in's active window [created_at, coalesce(checked_out_at,
-- expires_at)) into EVERY local hour it overlaps (an average concurrent
-- headcount, not just a start-hour proxy), in the caller's local offset.
-- Windows are clamped to 6 hours from created_at so a bad/missing
-- checked_out_at/expires_at can't blow up the generate_series. The
-- day-of-week filter applies to each BUCKET's local timestamp, not the
-- check-in's start, so a Sat 11:30pm check-in's spillover hours land on
-- Sunday.
WITH windows AS (
    SELECT
        ci.court_id,
        ci.party_size,
        (ci.created_at + (sqlc.arg(tz_offset_minutes)::int * interval '1 minute')) AS local_start,
        (LEAST(coalesce(ci.checked_out_at, ci.expires_at), ci.created_at + interval '6 hours')
            + (sqlc.arg(tz_offset_minutes)::int * interval '1 minute')) AS local_end
    FROM check_ins ci
    WHERE ci.court_id = ANY(sqlc.arg(court_ids)::uuid[])
      AND ci.created_at > now() - interval '56 days'
)
SELECT
    w.court_id,
    EXTRACT(HOUR FROM bucket)::int AS local_hour,
    coalesce(sum(w.party_size), 0)::int AS total_heads
FROM windows w
CROSS JOIN LATERAL generate_series(
    date_trunc('hour', w.local_start),
    date_trunc('hour', w.local_end - interval '1 microsecond'),
    interval '1 hour'
) AS bucket
WHERE EXTRACT(DOW FROM bucket) = sqlc.arg(dow)::int
GROUP BY w.court_id, local_hour;

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
