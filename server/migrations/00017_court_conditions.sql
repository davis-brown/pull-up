-- +goose Up
-- Player-confirmable court conditions (Phase 14): rim/net hardware columns
-- and a confirmations ledger giving every structured fact a freshness signal.
ALTER TABLE courts ADD COLUMN rim_type text CHECK (rim_type IN ('single','double'));
ALTER TABLE courts ADD COLUMN net_type text CHECK (net_type IN ('chain','nylon','none'));

CREATE TABLE court_fact_confirmations (
    court_id   uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fact       text NOT NULL,
    value      text NOT NULL CHECK (char_length(value) <= 40),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (court_id, user_id, fact)
);
CREATE INDEX court_fact_confirmations_court_fact_idx
    ON court_fact_confirmations (court_id, fact, created_at DESC);

-- +goose Down
DROP TABLE court_fact_confirmations;
ALTER TABLE courts DROP COLUMN net_type;
ALTER TABLE courts DROP COLUMN rim_type;
