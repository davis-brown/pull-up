-- +goose Up

-- User blocking (store UGC-policy requirement): a blocker no longer sees
-- the blocked user's chat messages, crowd reports, or planned runs.
CREATE TABLE blocked_users (
    blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

-- +goose Down
DROP TABLE blocked_users;
