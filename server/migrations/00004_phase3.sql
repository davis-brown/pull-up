-- +goose Up

-- Planned runs: a user schedules a session at a court; others RSVP.
CREATE TABLE sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id    uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    created_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_at   timestamptz NOT NULL,
    note        text CHECK (char_length(note) <= 280),
    canceled_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_court_upcoming ON sessions (court_id, starts_at) WHERE canceled_at IS NULL;

CREATE TABLE session_rsvps (
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     text NOT NULL DEFAULT 'going' CHECK (status IN ('going','out')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, user_id)
);

-- Court chat. hidden_at is moderation (admin hide), not deletion.
CREATE TABLE court_messages (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    court_id   uuid NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
    hidden_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX court_messages_court_idx ON court_messages (court_id, created_at DESC);

-- Messages and sessions are flaggable.
ALTER TABLE flags DROP CONSTRAINT flags_entity_type_check;
ALTER TABLE flags ADD CONSTRAINT flags_entity_type_check
    CHECK (entity_type IN ('court','photo','report','message','session'));

-- +goose Down
ALTER TABLE flags DROP CONSTRAINT flags_entity_type_check;
ALTER TABLE flags ADD CONSTRAINT flags_entity_type_check
    CHECK (entity_type IN ('court','photo','report'));
DROP TABLE court_messages;
DROP TABLE session_rsvps;
DROP TABLE sessions;
