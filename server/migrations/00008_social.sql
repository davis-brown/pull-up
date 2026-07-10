-- +goose Up

-- One-directional follow graph.
CREATE TABLE follows (
    follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id);

-- Profiles/avatars become reportable.
ALTER TABLE flags DROP CONSTRAINT flags_entity_type_check;
ALTER TABLE flags ADD CONSTRAINT flags_entity_type_check
    CHECK (entity_type IN ('court','photo','report','message','session','user'));

-- +goose Down
ALTER TABLE flags DROP CONSTRAINT flags_entity_type_check;
ALTER TABLE flags ADD CONSTRAINT flags_entity_type_check
    CHECK (entity_type IN ('court','photo','report','message','session'));
DROP TABLE follows;
