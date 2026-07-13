-- Task 6: /me/stats. Powers the profile player card: lifetime check-in
-- stats (games/courts/early-bird count/max-at-one-court), distinct
-- week-start dates for streak derivation, sessions created (host badge),
-- and the user's top-3 home courts by check-in count.

-- name: UserCheckInStats :one
-- Split out of the brief's single-query sketch: sqlc rejected the
-- LATERAL window-function trick (window functions aren't allowed to
-- feed a scalar aggregate in the same SELECT the way sqlc infers
-- column types), so max_at_one_court moves to its own query below.
-- Correctness over cleverness, per the brief.
SELECT count(*)::int AS games,
       count(DISTINCT court_id)::int AS courts,
       count(*) FILTER (WHERE EXTRACT(HOUR FROM (created_at + (sqlc.arg(tz_offset_minutes)::int * interval '1 minute'))) < 9)::int AS early
FROM check_ins
WHERE user_id = sqlc.arg(user_id);

-- name: UserMaxCheckInsAtOneCourt :one
-- The brief's fallback for max_at_one_court: a plain GROUP BY/ORDER
-- BY/LIMIT 1, correctness over cleverness.
SELECT count(*)::int AS max_at_one_court
FROM check_ins
WHERE user_id = sqlc.arg(user_id)
GROUP BY court_id
ORDER BY count(*) DESC
LIMIT 1;

-- name: UserCheckInWeeks :many
-- Distinct week-start dates (not ISO week-label strings, which are a bug
-- factory across year boundaries — see the brief) the user has at least
-- one check-in in, oldest first. weekStreak in Go walks these as
-- consecutive 7-day steps.
SELECT DISTINCT date_trunc('week', created_at + (sqlc.arg(tz_offset_minutes)::int * interval '1 minute'))::date AS week_start
FROM check_ins
WHERE user_id = sqlc.arg(user_id)
ORDER BY 1;

-- name: UserSessionCount :one
SELECT count(*)::int AS sessions
FROM sessions
WHERE created_by = sqlc.arg(user_id);

-- name: UserHomeCourts :many
-- Live count follows the party-size-sum convention used everywhere else
-- (courts.sql, forecast.sql): a live check-in's headcount is party_size,
-- not 1.
SELECT c.id AS court_id, c.name, count(ci.id)::int AS check_ins,
       coalesce((SELECT sum(a.party_size) FROM check_ins a
                 WHERE a.court_id = c.id AND a.checked_out_at IS NULL AND a.expires_at > now()), 0)::int AS live_count
FROM check_ins ci JOIN courts c ON c.id = ci.court_id
WHERE ci.user_id = sqlc.arg(user_id)
GROUP BY c.id, c.name
ORDER BY count(ci.id) DESC
LIMIT 3;
