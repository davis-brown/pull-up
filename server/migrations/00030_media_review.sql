-- +goose Up
-- Uploaded images remain private until an administrator approves them.
CREATE TABLE media_reviews (
    storage_key text PRIMARY KEY,
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose text NOT NULL CHECK (purpose IN ('court', 'avatar')),
    photo_id uuid REFERENCES court_photos(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_reviews_created_idx ON media_reviews(created_at);

-- +goose StatementBegin
CREATE FUNCTION queue_reviewed_object() RETURNS trigger AS $$
BEGIN
    PERFORM enqueue_owned_object(OLD.storage_key);
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
CREATE TRIGGER media_reviews_queue_deleted_object
AFTER DELETE ON media_reviews
FOR EACH ROW EXECUTE FUNCTION queue_reviewed_object();

-- +goose Down
DROP TRIGGER media_reviews_queue_deleted_object ON media_reviews;
DROP FUNCTION queue_reviewed_object();
DROP TABLE media_reviews;
