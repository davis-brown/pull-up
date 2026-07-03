# pull-up 🏀

Find live pickup basketball. A map of courts showing who's playing right now —
court locations are crowd-sourced and seeded from OpenStreetMap; live activity
comes from geo-verified check-ins and crowd reports.

## Stack

- **`server/`** — Go API (chi, pgx + sqlc, goose migrations) on PostgreSQL + PostGIS
- **`app/`** — Expo (React Native) app for iOS, Android, and web; Mapbox maps
  (`@rnmapbox/maps` native, `react-map-gl` on web)

## Local development

Requirements: Go 1.23+, Node 20+, Docker (for Postgres+PostGIS), and
[sqlc](https://docs.sqlc.dev) if you edit SQL queries.

```sh
make dev            # start postgres+postgis and run the API on :8080
make test           # go tests (integration tests need TEST_DATABASE_URL or the compose DB)
make seed-osm BBOX=30.19,-97.87,30.40,-97.65   # import OSM courts for a bbox (S,W,N,E)

cd app && npm install
npx expo run:ios    # dev build — Expo Go does NOT work (@rnmapbox/maps is a native module)
npx expo start --web
```

The API runs its migrations automatically on startup. Config is env-based —
see `server/internal/config/config.go` (`DATABASE_URL`, `JWT_SECRET`, `PORT`).

The app needs a Mapbox token: set `EXPO_PUBLIC_MAPBOX_TOKEN` (public `pk.` token)
and, for native builds, `MAPBOX_DOWNLOAD_TOKEN` (secret `sk.` token) — see
`app/app.config.ts`.

## How live activity works

- **Check-ins** — "I'm here", geo-verified server-side (within 150 m of the
  court), auto-expire after 2 hours. Expiry is read-time (`expires_at` filter);
  there is no background job.
- **Crowd reports** — "~8 playing, good run"; shown for 2 hours.
- **Passive geofencing** (phase 2, native only, opt-in) — the app monitors
  geofences for nearby courts and either prompts ("Looks like you're at Rucker
  Park — check in?") or checks in automatically, per user setting.

## Court data & attribution

Courts are crowd-sourced (submissions land as `pending` and get verified by
upvotes or a geo-verified check-in) and seeded from OpenStreetMap
(`cmd/osmseed`, Overpass API).

**Licensing:** OSM-derived courts (`source='osm'`) are © OpenStreetMap
contributors, licensed [ODbL](https://www.openstreetmap.org/copyright). The
attribution must remain visible in the app, and the OSM-derived subset of the
courts database is kept separable via the `source`/`osm_id` columns to honor
share-alike. Mapbox attribution is rendered by the map SDKs and must not be
hidden.
