-- +goose Up
ALTER TABLE users ADD COLUMN apple_refresh_token bytea;
ALTER TABLE users ADD COLUMN apple_event_time bigint NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN apple_email_forwarding boolean NOT NULL DEFAULT true;
-- This queue deliberately outlives a deleted user; it has no identity or FK.
CREATE TABLE apple_revocations (
    id bigserial PRIMARY KEY,
    encrypted_token bytea NOT NULL,
    client_id text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX apple_revocations_due_idx ON apple_revocations(next_attempt_at);

-- +goose Down
-- Do not silently discard outstanding revocations during a rollback.
-- +goose StatementBegin
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM apple_revocations) THEN
        RAISE EXCEPTION 'Drain Apple revocations before rolling back';
    END IF;
END $$;
-- +goose StatementEnd
DROP TABLE apple_revocations;
ALTER TABLE users DROP COLUMN apple_refresh_token;
ALTER TABLE users DROP COLUMN apple_event_time;
ALTER TABLE users DROP COLUMN apple_email_forwarding;
