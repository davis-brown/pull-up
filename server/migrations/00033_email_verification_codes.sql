-- +goose Up
-- Email verification moves from an emailed link to a 6-digit code typed into
-- the app that registered. token_hash now holds the hash of a verification id
-- the client keeps, code_hash the hash of the emailed code salted with that id,
-- so verifying needs both the registering client and the inbox. Links already
-- emailed can't be redeemed any more; signing in sends a fresh code.
DELETE FROM email_verification_tokens WHERE consumed_at IS NULL;
ALTER TABLE email_verification_tokens
    ADD COLUMN code_hash text NOT NULL DEFAULT '',
    ADD COLUMN attempts  smallint NOT NULL DEFAULT 0;
ALTER TABLE email_verification_tokens ALTER COLUMN code_hash DROP DEFAULT;

-- +goose Down
ALTER TABLE email_verification_tokens
    DROP COLUMN attempts,
    DROP COLUMN code_hash;
