-- +goose Up
-- Admin avatar-clear (handleAdminClearAvatar) writes an audit row with
-- action='clear_avatar', but admin_actions.action only allowed
-- 'promote'/'demote'. Widen the check constraint so that insert succeeds.
ALTER TABLE admin_actions DROP CONSTRAINT admin_actions_action_check;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_check
    CHECK (action IN ('promote', 'demote', 'clear_avatar'));

-- +goose Down
ALTER TABLE admin_actions DROP CONSTRAINT admin_actions_action_check;
ALTER TABLE admin_actions ADD CONSTRAINT admin_actions_action_check
    CHECK (action IN ('promote', 'demote'));
