-- +goose Up

-- Refresh-token chains are independent login families. Reuse response must
-- revoke only the affected chain, not every device belonging to the user.
ALTER TABLE refresh_tokens ADD COLUMN family_id uuid;
-- Parent links did not exist before this migration, so conservatively group a
-- user's legacy tokens together. Every newly-issued login gets its own family.
UPDATE refresh_tokens SET family_id = user_id;
ALTER TABLE refresh_tokens ALTER COLUMN family_id SET NOT NULL;
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
-- Record the replacement token so a concurrent replay of the same old token
-- can be answered with the same new pair instead of revoking the family.
ALTER TABLE refresh_tokens ADD COLUMN replaced_by_hash text;
CREATE INDEX refresh_tokens_replaced_by_hash_idx ON refresh_tokens (replaced_by_hash) WHERE replaced_by_hash IS NOT NULL;

-- Existing accounts predate verification and remain verified. New password
-- accounts are created with NULL; OAuth accounts are marked by their insert.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at = now();

-- Enrichment uses a retryable lease; enriched_at is set only after all
-- external work and database updates complete.
ALTER TABLE courts ADD COLUMN enrich_claimed_at timestamptz;
ALTER TABLE courts ADD COLUMN enrich_attempts int NOT NULL DEFAULT 0;

CREATE TABLE email_verification_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text NOT NULL UNIQUE,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX email_verification_tokens_one_active
    ON email_verification_tokens (user_id) WHERE consumed_at IS NULL;

-- Exact reported coordinates are not needed once the court distance has been
-- calculated. Dropping the column also erases coordinates already retained.
ALTER TABLE check_ins DROP COLUMN reported_location;

-- Photo metadata is not public until the Worker has validated and persisted
-- the corresponding object.
ALTER TABLE court_photos DROP CONSTRAINT court_photos_status_check;
ALTER TABLE court_photos ADD CONSTRAINT court_photos_status_check
    CHECK (status IN ('pending','visible','flagged','removed'));

-- Expired and duplicate legacy rows must be closed before enforcing one open
-- check-in per account. The handler serializes replacements on the user row;
-- this index is the final database backstop.
UPDATE check_ins
SET checked_out_at = expires_at
WHERE checked_out_at IS NULL AND expires_at <= now();

WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS n
    FROM check_ins
    WHERE checked_out_at IS NULL
)
UPDATE check_ins ci
SET checked_out_at = now()
FROM ranked r
WHERE ci.id = r.id AND r.n > 1;

CREATE UNIQUE INDEX check_ins_one_open_per_user
    ON check_ins (user_id) WHERE checked_out_at IS NULL;

-- R2 deletion is asynchronous. Triggers make media cleanup part of the same
-- transaction that replaces, clears, moderates, or cascade-deletes metadata.
CREATE TABLE object_deletion_queue (
    storage_key  text PRIMARY KEY,
    requested_at timestamptz NOT NULL DEFAULT now(),
    claimed_at   timestamptz,
    attempts     int NOT NULL DEFAULT 0
);
CREATE INDEX object_deletion_queue_claim_idx
    ON object_deletion_queue (requested_at)
    WHERE claimed_at IS NULL;

CREATE INDEX court_photos_storage_key_idx ON court_photos (storage_key);
CREATE INDEX users_avatar_url_idx ON users (avatar_url);

-- Pending uploads: keys that have been authorized but not yet referenced by
-- durable metadata. Stale rows are cleaned up by the cron and their R2 objects
-- removed, preventing orphan bytes when a client abandons an upload.
CREATE TABLE pending_uploads (
    storage_key text PRIMARY KEY,
    owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     text NOT NULL CHECK (purpose IN ('avatar','court_photo')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pending_uploads_owner_idx ON pending_uploads (owner_id);
CREATE INDEX pending_uploads_stale_idx ON pending_uploads (created_at);

-- +goose StatementBegin
CREATE FUNCTION enqueue_owned_object(key_to_delete text) RETURNS void AS $$
BEGIN
    IF key_to_delete IS NULL OR key_to_delete = '' OR key_to_delete LIKE '/%'
       OR key_to_delete LIKE '%..%' THEN
        RETURN;
    END IF;
    INSERT INTO object_deletion_queue (storage_key)
    VALUES (key_to_delete)
    ON CONFLICT (storage_key) DO UPDATE
        SET requested_at = LEAST(object_deletion_queue.requested_at, EXCLUDED.requested_at);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION queue_replaced_avatar() RETURNS trigger AS $$
BEGIN
    IF OLD.avatar_url IS DISTINCT FROM NEW.avatar_url
       AND OLD.avatar_url LIKE '/photos/%' THEN
        PERFORM enqueue_owned_object(substring(OLD.avatar_url FROM 9));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION queue_deleted_avatar() RETURNS trigger AS $$
BEGIN
    IF OLD.avatar_url LIKE '/photos/%' THEN
        PERFORM enqueue_owned_object(substring(OLD.avatar_url FROM 9));
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER users_queue_replaced_avatar
AFTER UPDATE OF avatar_url ON users
FOR EACH ROW EXECUTE FUNCTION queue_replaced_avatar();

CREATE TRIGGER users_queue_deleted_avatar
AFTER DELETE ON users
FOR EACH ROW EXECUTE FUNCTION queue_deleted_avatar();

-- +goose StatementBegin
CREATE FUNCTION queue_court_photo_object() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM enqueue_owned_object(OLD.storage_key);
        RETURN OLD;
    END IF;
    IF OLD.storage_key IS DISTINCT FROM NEW.storage_key THEN
        PERFORM enqueue_owned_object(OLD.storage_key);
    END IF;
    IF OLD.status <> 'removed' AND NEW.status = 'removed' THEN
        PERFORM enqueue_owned_object(NEW.storage_key);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER court_photos_queue_object
AFTER UPDATE OR DELETE ON court_photos
FOR EACH ROW EXECUTE FUNCTION queue_court_photo_object();

-- +goose Down

-- Reversing the verification requirement is unsafe while unverified password
-- accounts exist: the pre-migration code would treat them as fully verified.
-- Abort the rollback so operators must explicitly handle those accounts first.
-- +goose StatementBegin
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM users
        WHERE auth_provider = 'password' AND email_verified_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Cannot roll back 00014: unverified password users exist. Verify or delete them first.';
    END IF;
END $$;
-- +goose StatementEnd

DROP TRIGGER court_photos_queue_object ON court_photos;
DROP FUNCTION queue_court_photo_object();
DROP TRIGGER users_queue_deleted_avatar ON users;
DROP TRIGGER users_queue_replaced_avatar ON users;
DROP FUNCTION queue_deleted_avatar();
DROP FUNCTION queue_replaced_avatar();
DROP FUNCTION enqueue_owned_object(text);
DROP TABLE object_deletion_queue;

DROP INDEX pending_uploads_stale_idx;
DROP INDEX pending_uploads_owner_idx;
DROP TABLE pending_uploads;

DROP INDEX users_avatar_url_idx;
DROP INDEX court_photos_storage_key_idx;

DROP INDEX check_ins_one_open_per_user;
ALTER TABLE check_ins ADD COLUMN reported_location geography(Point, 4326);

DELETE FROM court_photos WHERE status = 'pending';
ALTER TABLE court_photos DROP CONSTRAINT court_photos_status_check;
ALTER TABLE court_photos ADD CONSTRAINT court_photos_status_check
    CHECK (status IN ('visible','flagged','removed'));

DROP TABLE email_verification_tokens;
ALTER TABLE users DROP COLUMN email_verified_at;

ALTER TABLE courts DROP COLUMN enrich_attempts;
ALTER TABLE courts DROP COLUMN enrich_claimed_at;

DROP INDEX refresh_tokens_replaced_by_hash_idx;
ALTER TABLE refresh_tokens DROP COLUMN replaced_by_hash;
DROP INDEX refresh_tokens_family_idx;
ALTER TABLE refresh_tokens DROP COLUMN family_id;
