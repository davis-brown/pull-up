-- +goose Up
-- OAuth users have no password; identity comes from the provider.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN auth_provider text NOT NULL DEFAULT 'password'
    CHECK (auth_provider IN ('password','google','apple'));
ALTER TABLE users ADD COLUMN oauth_subject text;
CREATE UNIQUE INDEX users_oauth_idx ON users (auth_provider, oauth_subject)
    WHERE oauth_subject IS NOT NULL;
ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE favorites (
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    court_id   uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, court_id)
);
CREATE INDEX favorites_court_idx ON favorites (court_id);

-- Expo push tokens; one row per device token, reassigned on login switch.
CREATE TABLE push_tokens (
    token      text PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);

ALTER TABLE flags ADD COLUMN resolved_at timestamptz;
ALTER TABLE flags ADD COLUMN resolved_by uuid REFERENCES users(id);

-- +goose Down
ALTER TABLE flags DROP COLUMN resolved_by;
ALTER TABLE flags DROP COLUMN resolved_at;
DROP TABLE push_tokens;
DROP TABLE favorites;
ALTER TABLE users DROP COLUMN is_admin;
DROP INDEX users_oauth_idx;
ALTER TABLE users DROP COLUMN oauth_subject;
ALTER TABLE users DROP COLUMN auth_provider;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
