-- +goose Up
-- Phase 16: your-window alerts. The device's IANA timezone lets the server
-- evaluate "is now inside this player's availability window" honestly;
-- window_alerts is the sent ledger backing the per-court cooldown.
ALTER TABLE users
    ADD COLUMN timezone text,
    ADD COLUMN window_alerts_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE window_alerts (
    user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    court_id uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    sent_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, court_id, sent_at)
);
CREATE INDEX window_alerts_cooldown_idx
    ON window_alerts (user_id, court_id, sent_at DESC);

-- +goose Down
DROP TABLE window_alerts;
ALTER TABLE users
    DROP COLUMN window_alerts_enabled,
    DROP COLUMN timezone;
