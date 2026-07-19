-- +goose Up
-- Beta feedback reuses the flags pipeline: entity_type 'feedback' with
-- entity_id set to the reporting user's id (flags.entity_id is NOT NULL and
-- feedback has no other target). Surfaces in the existing admin queue.
ALTER TABLE flags DROP CONSTRAINT flags_entity_type_check;
ALTER TABLE flags ADD CONSTRAINT flags_entity_type_check
    CHECK (entity_type IN ('court','photo','report','message','session','user','feedback'));

-- +goose Down
ALTER TABLE flags DROP CONSTRAINT flags_entity_type_check;
ALTER TABLE flags ADD CONSTRAINT flags_entity_type_check
    CHECK (entity_type IN ('court','photo','report','message','session','user'));
