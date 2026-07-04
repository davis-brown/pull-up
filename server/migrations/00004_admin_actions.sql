-- +goose Up
-- Audit trail for admin-rights changes (promote/demote via the admin API).
CREATE TABLE admin_actions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action          text NOT NULL CHECK (action IN ('promote', 'demote')),
    target_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_created_idx ON admin_actions (created_at DESC);

-- +goose Down
DROP TABLE admin_actions;
