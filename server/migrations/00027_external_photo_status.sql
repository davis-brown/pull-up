-- +goose Up
-- Auto-fetched external photos (Commons/Mapillary) land within 80-200 m of a
-- court and can be off-target (a street, the block over) or otherwise unwanted.
-- Until now there was no way to hide one. Add a moderation status mirroring
-- court_photos: 'visible' (default) or 'hidden'. ListExternalPhotos filters to
-- visible; an admin action flips a bad one to hidden.
ALTER TABLE external_photos
    ADD COLUMN status text NOT NULL DEFAULT 'visible'
    CHECK (status IN ('visible', 'hidden'));

-- +goose Down
ALTER TABLE external_photos DROP COLUMN status;
