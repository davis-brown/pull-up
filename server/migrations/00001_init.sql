-- +goose Up
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         citext UNIQUE NOT NULL,
    password_hash text NOT NULL,
    display_name  text NOT NULL,
    avatar_url    text,
    reputation    int NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE courts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    location     geography(Point, 4326) NOT NULL,
    address      text,
    hoop_count   smallint,
    indoor       boolean NOT NULL DEFAULT false,
    surface      text CHECK (surface IN ('asphalt','concrete','hardwood','rubber','other')),
    lighting     boolean,
    is_public    boolean NOT NULL DEFAULT true,
    source       text NOT NULL DEFAULT 'user' CHECK (source IN ('user','osm')),
    osm_type     text CHECK (osm_type IN ('node','way','relation')),
    osm_id       bigint,
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
    submitted_by uuid REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (osm_type, osm_id)
);
CREATE INDEX courts_location_gist ON courts USING GIST (location);
CREATE INDEX courts_status_idx ON courts (status);

CREATE TABLE check_ins (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id          uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','geofence_prompt','geofence_auto')),
    reported_location geography(Point, 4326),
    distance_m        real,
    created_at        timestamptz NOT NULL DEFAULT now(),
    expires_at        timestamptz NOT NULL,
    checked_out_at    timestamptz
);
CREATE INDEX check_ins_court_active ON check_ins (court_id, expires_at) WHERE checked_out_at IS NULL;
CREATE INDEX check_ins_user_idx ON check_ins (user_id, created_at DESC);

CREATE TABLE crowd_reports (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id     uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_count smallint CHECK (player_count >= 0 AND player_count <= 200),
    run_quality  text CHECK (run_quality IN ('empty','casual','good_run','packed')),
    note         text CHECK (char_length(note) <= 280),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crowd_reports_court_idx ON crowd_reports (court_id, created_at DESC);

CREATE TABLE court_votes (
    court_id   uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vote       smallint NOT NULL CHECK (vote IN (-1, 1)),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (court_id, user_id)
);

CREATE TABLE court_photos (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id    uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    storage_key text NOT NULL,
    width       int,
    height      int,
    status      text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','flagged','removed')),
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX court_photos_court_idx ON court_photos (court_id);

CREATE TABLE flags (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type text NOT NULL CHECK (entity_type IN ('court','photo','report')),
    entity_id   uuid NOT NULL,
    reason      text NOT NULL CHECK (char_length(reason) <= 500),
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE flags;
DROP TABLE court_photos;
DROP TABLE court_votes;
DROP TABLE crowd_reports;
DROP TABLE check_ins;
DROP TABLE courts;
DROP TABLE refresh_tokens;
DROP TABLE users;
