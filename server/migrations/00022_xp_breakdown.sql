-- +goose Up
-- Phase 21: make earned XP legible, and give levelling up a moment.
--
-- xp_events has been append-only-and-never-read since phase 20: every read
-- path uses the cached users.xp scalar, so a player sees a level and a bar
-- with no way to tell what moves them. The breakdown query reads the ledger
-- directly (xp_events_user_created_idx already covers user_id + created_at),
-- so nothing new is captured here.
--
-- level_up_pending holds the level a player crossed into but hasn't been
-- shown yet. It exists because awardCheckInXP runs OFF the request path:
-- the check-in response has already been written by the time the award
-- lands, so the crossing cannot be reported in that response. Storing it
-- lets the next /me/stats carry it.
--
-- It is explicitly ACKed (POST /me/level-up/ack) rather than cleared by the
-- read. The app fetches stats on resume and in the background, so
-- clear-on-read would routinely burn the celebration on a fetch no one saw.
ALTER TABLE users ADD COLUMN level_up_pending int
    CHECK (level_up_pending IS NULL OR level_up_pending > 1);

-- +goose Down
ALTER TABLE users DROP COLUMN level_up_pending;
