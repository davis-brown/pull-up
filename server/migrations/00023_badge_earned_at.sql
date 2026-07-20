-- +goose Up
-- Phase 21b: remember WHEN a badge was earned, so a newly-earned one can be
-- celebrated the way a level crossing now is.
--
-- Badges stay DERIVED (deriveBadges in stats_handlers.go computes them from
-- check-in stats on every read, so they are always correct and can never
-- drift from the underlying numbers). This table does not store whether a
-- badge is earned — only the first time we observed it, plus whether the
-- player has been shown it. Losing a row degrades to "not yet celebrated",
-- never to "badge revoked".
CREATE TABLE user_badges (
    user_id   uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug      text        NOT NULL,
    earned_at timestamptz NOT NULL DEFAULT now(),
    -- NULL until the app has shown this badge to the player.
    seen_at   timestamptz,
    PRIMARY KEY (user_id, slug)
);

-- badges_synced_at marks that a player's badge baseline has been taken.
--
-- This exists to stop the feature from launching badly. Every existing
-- player already satisfies several badge rules, so without a baseline the
-- first /me/stats after deploy would record all of them as newly earned and
-- celebrate six badges the player won a month ago. Deliberately left NULL
-- for everyone, including new signups: the first stats read takes the
-- baseline, recording whatever is already earned as ALREADY SEEN, and only
-- badges earned after that point are treated as new. A brand-new player's
-- baseline is empty, so their genuine first badge still gets its moment.
ALTER TABLE users ADD COLUMN badges_synced_at timestamptz;

-- +goose Down
ALTER TABLE users DROP COLUMN badges_synced_at;
DROP TABLE user_badges;
