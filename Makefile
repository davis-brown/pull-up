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

## Deploy (Cloudflare) ----------------------------------------------------

# One-time: npx wrangler login, then in deploy/api:
#   npx wrangler secret put DATABASE_URL && npx wrangler secret put JWT_SECRET
# Requires local Docker to build the container image (or use the
# cloudflare-deploy GitHub Actions workflow instead).
deploy-api:
	cd deploy/api && npm install && npx wrangler deploy

# API_URL is the deployed API worker URL; MAPBOX token comes from app/.env
# or the environment.
deploy-web:
	cd app && EXPO_PUBLIC_API_URL=$(API_URL) npx expo export --platform web
	cd app && npx wrangler deploy

app:
	cd app && npx expo start

app-web:
	cd app && npx expo start --web

typecheck:
	cd app && npx tsc --noEmit
