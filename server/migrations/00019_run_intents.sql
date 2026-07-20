-- +goose Up
-- Phase 19: looking-for-a-run. A player marks "I want to play" for a
-- symbolic (court, date, availability-window) bucket; run_intents is the
-- one-row-per-seeker-per-bucket table the court page lists publicly.
-- run_intent_bucket_events is a fire-once ledger per bucket (not per user)
-- so the threshold push and the "a run was planned" conversion push each
-- go out exactly once, however the bucket's membership churns afterward.
CREATE TABLE run_intents (
    court_id   uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    run_date   date NOT NULL,
    window_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (court_id, user_id, run_date, window_key)
);
CREATE INDEX run_intents_bucket_idx ON run_intents (court_id, run_date, window_key);

CREATE TABLE run_intent_bucket_events (
    court_id             uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    run_date             date NOT NULL,
    window_key           text NOT NULL,
    threshold_alerted_at timestamptz,
    converted_at         timestamptz,
    PRIMARY KEY (court_id, run_date, window_key)
);

-- +goose Down
DROP TABLE run_intent_bucket_events;
DROP TABLE run_intents;
