-- +goose Up
-- Phase 20: XP and player levels. Deliberately a SEPARATE track from
-- users.reputation: reputation weights court-verification voting, so
-- letting play activity buy it would let a grinder buy moderation power.
-- XP means "this player shows up"; reputation means "this account is
-- trustworthy".
--
-- xp_events is append-only. dedup_key makes every award idempotent (one
-- per check-in, per session, per court, per day, per week — the awarding
-- site builds the key), which is what keeps retries and double-fires from
-- inflating a level. users.xp is a cached running total so the common
-- read (profile/player card) never sums the ledger.
CREATE TABLE xp_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       text NOT NULL,
    points     int NOT NULL CHECK (points > 0),
    dedup_key  text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX xp_events_dedup_idx ON xp_events (user_id, dedup_key);
-- Backs the per-day cap lookup (sum of today's points for a user).
CREATE INDEX xp_events_user_created_idx ON xp_events (user_id, created_at DESC);

ALTER TABLE users
    ADD COLUMN xp int NOT NULL DEFAULT 0,
    ADD COLUMN play_nudges_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN last_play_nudge_at timestamptz;

-- +goose Down
ALTER TABLE users
    DROP COLUMN last_play_nudge_at,
    DROP COLUMN play_nudges_enabled,
    DROP COLUMN xp;
DROP TABLE xp_events;
