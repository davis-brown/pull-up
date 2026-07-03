DATABASE_URL ?= postgres://pullup:pullup@localhost:5432/pullup?sslmode=disable

.PHONY: dev db-up db-down api test vet generate seed-osm app app-web typecheck

## Backend ---------------------------------------------------------------

db-up:
	docker compose up -d db

db-down:
	docker compose down

# Run the API against the local compose DB (migrations run automatically on startup).
api:
	cd server && DATABASE_URL=$(DATABASE_URL) go run ./cmd/api

dev: db-up api

test:
	cd server && go test ./...

vet:
	cd server && go vet ./...

# Regenerate the sqlc store layer after editing server/internal/store/queries/*.sql
generate:
	cd server && sqlc generate

# Seed courts from OpenStreetMap for a bounding box (south,west,north,east).
# Example: make seed-osm BBOX=30.19,-97.87,30.40,-97.65
seed-osm:
	cd server && DATABASE_URL=$(DATABASE_URL) go run ./cmd/osmseed -bbox $(BBOX)

## App -------------------------------------------------------------------

app:
	cd app && npx expo start

app-web:
	cd app && npx expo start --web

typecheck:
	cd app && npx tsc --noEmit
