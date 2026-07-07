# pull-up 🏀

Find live pickup basketball. A map of courts showing who's playing right now —
court locations are crowd-sourced and seeded from OpenStreetMap; live activity
comes from geo-verified check-ins and crowd reports.

## Stack

- **`server/`** — Go API (chi, pgx + sqlc, goose migrations) on PostgreSQL + PostGIS
- **`app/`** — Expo (React Native) app for iOS, Android, and web; MapLibre maps
  with OpenFreeMap tiles (`@maplibre/maplibre-react-native` native,
  `react-map-gl/maplibre` on web) — no map API keys needed

## Local development

Requirements: Go 1.23+, Node 20+, Docker (for Postgres+PostGIS), and
[sqlc](https://docs.sqlc.dev) if you edit SQL queries.

```sh
make dev            # start postgres+postgis and run the API on :8080
make seed-osm BBOX=30.19,-97.87,30.40,-97.65   # import OSM courts for a bbox (S,W,N,E)

cd app && npm install
npx expo run:ios    # dev build — Expo Go does NOT work (MapLibre is a native module)
npx expo start --web
```

### Tests

```sh
make test           # server: unit tests only (DB-backed tests skip without TEST_DATABASE_URL)
make test-app       # app: jest unit tests (lib/api.ts token refresh & auth client)

# Server integration tests (store queries + full HTTP API) need a scratch
# Postgres with PostGIS — e.g. a second database on the compose instance:
TEST_DATABASE_URL=postgres://pullup:pullup@localhost:5432/pullup_test?sslmode=disable \
  make test
```

The API integration tests in `server/internal/api` spin up the real router
against the test database and drive it over HTTP: auth (register/login/
refresh rotation/logout), courts (create/dupe-detect/vote thresholds),
geo-verified check-ins, crowd reports, photos, favorites, push tokens,
flags, and the whole admin/moderation flow. CI runs all of this plus the
app's typecheck and jest suite on every push.

The API runs its migrations automatically on startup. Config is env-based —
see `server/internal/config/config.go` (`DATABASE_URL`, `JWT_SECRET`, `PORT`).

Maps need no API keys: tiles come from [OpenFreeMap](https://openfreemap.org).
The only app config is `EXPO_PUBLIC_API_URL` — see `app/.env.example`.

## How live activity works

- **Check-ins** — "I'm here", geo-verified server-side (within 150 m of the
  court), auto-expire after 2 hours. Expiry is read-time (`expires_at` filter);
  there is no background job.
- **Crowd reports** — "~8 playing, good run"; shown for 2 hours.
- **Passive geofencing** (phase 2, native only, opt-in) — the app monitors
  geofences for nearby courts and either prompts ("Looks like you're at Rucker
  Park — check in?") or checks in automatically, per user setting.

## Moderation & admins

Anyone signed in can report a court, photo, or crowd report (flag icons in
the app → `POST /flags`). Admins get a moderation queue (Profile →
"Moderation queue") to review open flags, reject courts, remove photos, and
resolve reports.

Admin rights are managed in-app with a security model designed to avoid
both self-escalation and lock-out:

- **Bootstrap the first admin out-of-band** (one-time, direct SQL):
  `UPDATE users SET is_admin = true WHERE email = 'you@example.com';`
- **Every admin after that** is promoted (or demoted) by an existing admin
  from the moderation screen — `POST /admin/users/{id}/admin`, gated by
  `is_admin` checked live per request, never baked into the JWT.
- **Demoting the last remaining admin is rejected** server-side, so the
  account base can never lose moderation access entirely.
- **Every promote/demote is recorded** in the `admin_actions` audit table
  and shown in the moderation screen's "Recent admin activity" feed.

## Deploying (Cloudflare)

- **Web app** → Cloudflare Workers static assets (`app/wrangler.jsonc`), free.
- **Go API** → Cloudflare Containers (`deploy/api/`): a tiny Worker proxies
  into the container built from `server/Dockerfile`. Requires the **Workers
  Paid** plan and, for local deploys, a running Docker daemon (CI deploys via
  `.github/workflows/deploy.yml` avoid that).
- **Database** → Cloudflare has no Postgres; use [Neon](https://neon.tech)
  (free tier, PostGIS supported): create a project, then
  `CREATE EXTENSION postgis;` runs automatically via our migrations on API
  startup.

One-time setup:

```sh
npx wrangler login
cd deploy/api && npm install
npx wrangler secret put DATABASE_URL   # Neon connection string (pooled)
npx wrangler secret put JWT_SECRET     # openssl rand -hex 32
```

Then, from the repo root:

```sh
make deploy-api                                    # needs Docker locally
make deploy-web API_URL=https://pull-up-api.<your-subdomain>.workers.dev
```

Or push to `main` with the `CLOUDFLARE_API_TOKEN` and `EXPO_PUBLIC_API_URL`
repo secrets set and let GitHub Actions deploy both.

## Court data & attribution

Courts are crowd-sourced (submissions land as `pending` and get verified by
upvotes or a geo-verified check-in) and seeded from OpenStreetMap
(`cmd/osmseed`, Overpass API).

**Licensing:** OSM-derived courts (`source='osm'`) are © OpenStreetMap
contributors, licensed [ODbL](https://www.openstreetmap.org/copyright). The
attribution must remain visible in the app, and the OSM-derived subset of the
courts database is kept separable via the `source`/`osm_id` columns to honor
share-alike. Map tiles are served by OpenFreeMap (also OSM-derived); the map's
attribution control must stay visible.
