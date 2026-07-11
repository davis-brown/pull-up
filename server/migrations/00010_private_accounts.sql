-- +goose Up
ALTER TABLE users ADD COLUMN is_private boolean NOT NULL DEFAULT false;

-- Pending follow requests for private accounts. Kept separate from `follows`
-- (which always means an accepted follow) so existing follow queries are
-- unaffected. Accepting a request moves the row into `follows`.
CREATE TABLE follow_requests (
    requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (requester_id, target_id),
    CHECK (requester_id <> target_id)
);
CREATE INDEX follow_requests_target_idx ON follow_requests (target_id, created_at DESC);

-- +goose Down
DROP TABLE follow_requests;
ALTER TABLE users DROP COLUMN is_private;
