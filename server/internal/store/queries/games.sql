-- Phase 18: recorded games -------------------------------------------------

-- name: CreateGame :one
INSERT INTO games (court_id, recorded_by, winning_team, score_win, score_lose)
VALUES (
    sqlc.arg('court_id'), sqlc.arg('recorded_by'), sqlc.arg('winning_team'),
    sqlc.narg('score_win')::smallint, sqlc.narg('score_lose')::smallint
)
RETURNING id, court_id, recorded_by, winning_team, score_win, score_lose,
    status, confirmed_at, played_at;

-- name: AddGameParticipant :exec
-- The recorder is auto-confirmed: they're the one making the claim, so
-- their agreement is implied and can't count toward confirming it.
INSERT INTO game_participants (game_id, user_id, team, confirmed_at)
VALUES (
    sqlc.arg('game_id'), sqlc.arg('user_id'), sqlc.arg('team'),
    CASE WHEN sqlc.arg('is_recorder')::bool THEN now() ELSE NULL END
);

-- name: GetGame :one
SELECT id, court_id, recorded_by, winning_team, score_win, score_lose,
    status, confirmed_at, played_at
FROM games WHERE id = $1;

-- name: GetGameParticipant :one
SELECT game_id, user_id, team, confirmed_at
FROM game_participants
WHERE game_id = sqlc.arg('game_id') AND user_id = sqlc.arg('user_id');

-- name: ConfirmGameParticipant :execrows
-- Records one participant's agreement. Idempotent: a second tap changes
-- nothing (and so reports 0 rows, letting the caller skip the follow-on
-- work rather than re-awarding XP).
UPDATE game_participants SET confirmed_at = now()
WHERE game_id = sqlc.arg('game_id') AND user_id = sqlc.arg('user_id')
  AND confirmed_at IS NULL;

-- name: ConfirmGameIfOpposingAgreed :execrows
-- Flips a game to confirmed once someone on the losing side has agreed.
-- The "opposing" test is against winning_team, so a game is only ever
-- validated by a player with no incentive to inflate it. Guarded on
-- status so the caller can tell whether IT did the flip (1 row) and
-- should award XP, or whether it was already confirmed (0 rows).
UPDATE games g SET status = 'confirmed', confirmed_at = now()
WHERE g.id = sqlc.arg('game_id')
  AND g.status = 'unconfirmed'
  AND EXISTS (
      SELECT 1 FROM game_participants p
      WHERE p.game_id = g.id
        AND p.team <> g.winning_team
        AND p.confirmed_at IS NOT NULL
  );

-- name: ListGameParticipants :many
SELECT p.game_id, p.user_id, p.team, p.confirmed_at,
    u.display_name, u.avatar_url
FROM game_participants p
JOIN users u ON u.id = p.user_id
WHERE p.game_id = ANY(sqlc.arg('game_ids')::uuid[])
ORDER BY p.team, u.display_name;

-- name: ListCourtGames :many
-- Confirmed games at a court, most recent first. Confirmed only: an
-- unconfirmed result is a claim, not a fact, and never appears publicly.
SELECT id, court_id, recorded_by, winning_team, score_win, score_lose,
    status, confirmed_at, played_at
FROM games
WHERE court_id = sqlc.arg('court_id') AND status = 'confirmed'
ORDER BY played_at DESC
LIMIT sqlc.arg('max_games');

-- name: ListPendingGameConfirmations :many
-- Games waiting on THIS player's confirmation: still unconfirmed, they're
-- on the losing side (the only side whose agreement settles it), and they
-- haven't answered yet.
SELECT g.id, g.court_id, c.name AS court_name, g.recorded_by,
    u.display_name AS recorded_by_name,
    g.winning_team, g.score_win, g.score_lose, g.played_at,
    p.team AS my_team
FROM games g
JOIN game_participants p ON p.game_id = g.id AND p.user_id = sqlc.arg('user_id')
JOIN courts c ON c.id = g.court_id
JOIN users u ON u.id = g.recorded_by
WHERE g.status = 'unconfirmed'
  AND p.confirmed_at IS NULL
  AND p.team <> g.winning_team
ORDER BY g.played_at DESC
LIMIT 20;

-- name: UserGameRecord :one
-- A player's W-L across confirmed games only.
SELECT
    count(*) FILTER (WHERE p.team = g.winning_team)::int AS wins,
    count(*) FILTER (WHERE p.team <> g.winning_team)::int AS losses
FROM game_participants p
JOIN games g ON g.id = p.game_id
WHERE p.user_id = sqlc.arg('user_id') AND g.status = 'confirmed';

-- name: ExpireUnconfirmedGames :execrows
-- A contested (or ignored) result simply stops existing after 48h rather
-- than going to arbitration.
DELETE FROM games
WHERE status = 'unconfirmed' AND created_at < now() - interval '48 hours';
