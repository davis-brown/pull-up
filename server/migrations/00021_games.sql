-- +goose Up
-- Phase 18: recorded pickup games. A game result is the one claim in this
-- app that's *about other people*, so it doesn't count until the other
-- side agrees: a game is born 'unconfirmed' (visible only to its
-- participants, worth no XP, absent from stats) and only becomes
-- 'confirmed' when someone on the OPPOSING team confirms it. Teammates
-- confirming each other would be nearly as farmable as recording
-- unilaterally, which matters now that games award XP.
--
-- Unconfirmed games are swept after 48h rather than arbitrated: a
-- contested pickup result should simply not exist.
CREATE TABLE games (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id     uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    recorded_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Which team won: teams are just 0 and 1, formed ad hoc per game.
    winning_team smallint NOT NULL CHECK (winning_team IN (0, 1)),
    -- Optional final score, winner's points first. Both or neither.
    score_win    smallint CHECK (score_win >= 0 AND score_win <= 200),
    score_lose   smallint CHECK (score_lose >= 0 AND score_lose <= 200),
    status       text NOT NULL DEFAULT 'unconfirmed'
                     CHECK (status IN ('unconfirmed', 'confirmed')),
    confirmed_at timestamptz,
    played_at    timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT games_score_pairwise CHECK (
        (score_win IS NULL) = (score_lose IS NULL)
    ),
    CONSTRAINT games_score_winner_leads CHECK (
        score_win IS NULL OR score_win > score_lose
    )
);
CREATE INDEX games_court_idx ON games (court_id, played_at DESC);
-- Backs the 48h expiry sweep.
CREATE INDEX games_unconfirmed_idx ON games (created_at) WHERE status = 'unconfirmed';

CREATE TABLE game_participants (
    game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team         smallint NOT NULL CHECK (team IN (0, 1)),
    confirmed_at timestamptz,
    PRIMARY KEY (game_id, user_id)
);
-- Backs "games I'm in that need my confirmation" and a player's W-L.
CREATE INDEX game_participants_user_idx ON game_participants (user_id);

-- +goose Down
DROP TABLE game_participants;
DROP TABLE games;
