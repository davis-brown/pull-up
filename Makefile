DATABASE_URL ?= postgres://pullup:pullup@localhost:5432/pullup?sslmode=disable
# Scratch database for the DB-backed tests. Deliberately NOT the dev DB
# ($DATABASE_URL / pullup): the tests TRUNCATE tables between cases, so they
# must run against a throwaway database. Mirrors CI (see .github/workflows/ci.yml).
TEST_DATABASE_URL ?= postgres://pullup:pullup@localhost:5432/pullup_test?sslmode=disable
DEV_JWT_SECRET := local-development-jwt-secret-0000000000000001
DEV_UPLOAD_SECRET := local-development-upload-secret-00000000001
DEV_INTERNAL_SECRET := local-development-internal-secret-0000000001

.PHONY: dev db-up db-down api test test-int test-app vet generate seed-osm app app-web typecheck

## Backend ---------------------------------------------------------------

db-up:
	docker compose up -d db

db-down:
	docker compose down

# Run the API against the local compose DB (migrations run automatically on startup).
api:
	@cd server && DATABASE_URL="$(DATABASE_URL)" \
		JWT_SECRET="$(DEV_JWT_SECRET)" \
		UPLOAD_SIGNING_SECRET="$(DEV_UPLOAD_SECRET)" \
		INTERNAL_TASK_SECRET="$(DEV_INTERNAL_SECRET)" \
		go run ./cmd/api

dev: db-up api

# Fast path: unit tests only. The DB-backed store/API integration tests skip
# themselves unless TEST_DATABASE_URL is set (see `make test-int`).
test:
	cd server && go test ./...

# Full path: run everything, including the PostGIS integration tests, against a
# local scratch database in the compose Postgres. The test harness applies
# migrations and truncates between cases, so this just needs the database to
# exist. Requires Docker; `make test` covers the rest without it.
test-int: db-up
	@echo "waiting for postgres to accept connections..."
	@until docker compose exec -T db pg_isready -U pullup >/dev/null 2>&1; do sleep 1; done
	@docker compose exec -T db psql -U pullup -d pullup -tc \
		"SELECT 1 FROM pg_database WHERE datname = 'pullup_test'" | grep -q 1 || \
		docker compose exec -T db psql -U pullup -d pullup -c "CREATE DATABASE pullup_test"
	cd server && TEST_DATABASE_URL="$(TEST_DATABASE_URL)" go test ./...

test-app:
	cd app && npm test

vet:
	cd server && go vet ./...

# Regenerate the sqlc store layer after editing server/internal/store/queries/*.sql
generate:
	cd server && sqlc generate

# Seed courts from OpenStreetMap for a bounding box (south,west,north,east).
# Example: make seed-osm BBOX=30.19,-97.87,30.40,-97.65
seed-osm:
	@cd server && DATABASE_URL="$(DATABASE_URL)" go run ./cmd/osmseed -bbox "$(BBOX)"

## App -------------------------------------------------------------------

## Deploy (Cloudflare) ----------------------------------------------------

# One-time: npx wrangler login, then in deploy/api:
#   npx wrangler secret put DATABASE_URL
#   npx wrangler secret put JWT_SECRET
#   npx wrangler secret put UPLOAD_SIGNING_SECRET
#   npx wrangler secret put INTERNAL_TASK_SECRET
# Requires local Docker to build the container image (or use the
# cloudflare-deploy GitHub Actions workflow instead).
deploy-api:
	cd deploy/api && npm ci && npm run deploy

# WEB_ORIGIN is the canonical deployed web origin; the web client proxies API
# requests through the same origin, so both URLs must point there.
deploy-web:
	cd app && EXPO_PUBLIC_API_URL="$(WEB_ORIGIN)" EXPO_PUBLIC_WEB_URL="$(WEB_ORIGIN)" npx expo export --platform web
	deploy/api/node_modules/.bin/wrangler deploy --cwd app

app:
	cd app && npx expo start

app-web:
	cd app && npx expo start --web

typecheck:
	cd app && npx tsc --noEmit
