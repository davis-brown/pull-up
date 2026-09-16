# pull-up 🏀

Find live pickup basketball. A map of courts showing who's playing right now —
court locations are crowd-sourced and seeded from OpenStreetMap; live activity
comes from geo-verified check-ins and crowd reports.

## Features

**Map & courts**
- Live map (MapLibre) with a basketball-icon pin per court; pin grows and
  turns green with a live player count once a court has active check-ins
- "Now" and "All courts" map modes — Now shows only courts with live
  activity, weighted by turnout; All shows every court
- Search globally by court name, neighborhood, or city; area results jump the
  map and load courts through the same viewport discovery flow
- Time scrubber on the map — drag to any hour and see a per-court turnout
  forecast (8-week hourly averages blended with today's scheduled runs)
- Courts are crowd-sourced (community "add a court" pin-drop flow, with
  nearby-duplicate detection) and auto-seeded from OpenStreetMap per
  viewport in the background
- Structured court attributes — surface (asphalt/concrete/hardwood/rubber/
  other), hoop count, lighting, indoor/covered, fee to play, drinking water,
  restrooms, parking, fenced, access (public/private/customers) — editable
  by anyone signed in
- Court photos (upload, moderated)
- Filter courts with quick presets (Night run / Serious run / Rainy day /
  Shoot around) or fine-tune chips (incl. min hoops and surface), with a
  live matching count as you adjust
- Favorite courts and view your favorites list
- Court detail screen with a facts grid, a popular-times chart, and a
  sticky check-in bar
- Desktop web (≥1024px) gets a master-detail layout — court list and detail
  panel alongside the map

**Live activity**
- Check-ins — a one-gesture slide-to-check-in screen, with party size
  (+1/+2/+3) and a "got a ball" flag; headcounts count party sizes, not
  just check-ins. Geo-verified server-side (within 150 m of the court),
  auto-expire after 2 hours, no background job required
- Crowd reports — "~8 playing, good run" style reports, visible for 2 hours
- Passive geofencing (native only, opt-in) — monitors nearby known courts
  and either prompts ("Looks like you're at Rucker Park — check in?") or
  checks in automatically, per user setting, with a prominent
  background-location disclosure screen before enabling it
- Discover/Activity feed — nearby courts ranked by liveness then distance,
  a "friends here" strip, and upcoming runs from people you follow
- Your-window alerts — when a favorite court's live headcount crosses the
  threshold during one of your availability windows, you get a push
  ("Now at Rucker Park: 5 playing"); once per court per day, timezone-aware,
  optional (Profile settings → Court alerts)

**Planned runs (sessions)**
- Looking for a run — mark "I'm looking to play" for a day + availability
  window at a court; the demand is public ("3 players want to run Thursday
  evening"), and hitting 4 seekers pushes everyone to plan it. Planning a
  run in a matching window notifies that bucket's seekers to RSVP
- Open-run discovery — a "Runs near you" rail on the Activity tab shows
  upcoming runs at any nearby court (no follows needed, guests included),
  and courts with a run in the next 24h carry a run tick on their map pin
- Schedule a run at a court (quick-pick day/time chips + optional note)
- RSVP to a run and see who else is attending
- Cancel a run you organized
- Share a run via the native share sheet / a deep link

**Court chat**
- Per-court message board to coordinate with the regulars at that court
  (moderated, same flagging path as everything else)

**Games & scores**
- Record a pickup game from the players checked in at the court — two ad-hoc
  sides, who won, and an optional score
- A result is a claim about other people, so it counts only when the
  *losing* side confirms it: unconfirmed games are visible to nobody but
  their participants, earn no XP, and are swept after 48h rather than
  arbitrated. Winners and the recorder can't confirm their own result
- Confirmed games give every participant XP and feed a W–L record on the
  player card. Win *rate* is deliberately never gamified — recording is
  voluntary, so rewarding it would only reward logging your wins

**Levels & XP**
- Players earn XP for showing up — checking in, turning an RSVP into an
  actual appearance, planning runs that draw a crowd, adding courts that get
  verified, keeping a court's conditions current, and week streaks — and
  level up through six tiers (Rookie → Legend). Deliberately a separate
  track from reputation, which weights court verification: play activity
  must never buy moderation power
- Anti-farming by design: every award is dedup-keyed, repeat check-ins at
  one court inside 20h earn nothing, and a day is capped at 75 XP
- One opt-out-able nudge — late in the week, in your own timezone, when a
  streak you built is about to lapse

**Social**
- Public user profiles with a reputation score
- Shareable player card — jersey number, position, height, and style tags
- Stats (games played, courts visited, week streak) and earned badges, plus
  your home courts
- Follow / unfollow, with followers/following lists
- Private accounts — new followers require your approval (follow requests
  screen)
- Block / unblock other users
- Feed of followed users' check-ins and upcoming runs

**Account & sign-in**
- Verified email/password auth with refresh-token-family rotation, plus Sign
  in with Google and Sign in with Apple
- Avatar upload/removal, editable display name, system/light/dark theme
- Push notification token registration
- Self-service account deletion — cascades your check-ins, messages,
  photos, and favorites; courts you added stay on the map, anonymized

**Sharing & deep links**
- Universal/app links for a court (`/court/<id>`) or a specific run
  (`?run=<sessionId>`) open the native app when installed, the web app
  otherwise

**Moderation & trust/safety**
- Flag courts, photos, crowd reports, messages, sessions, or users
- Admin moderation queue — resolve flags, set court/photo/message status
- Admin management — search users, promote/demote admins (checked live on
  every request, never baked into the JWT; demoting the last admin is
  rejected server-side), with every promote/demote recorded in an audit log
  visible in the moderation screen

**Reliability**
- Durable background work — OSM seeding and enrichment run off a DB-backed
  queue (not in-memory), drained on the request warm path and by a
  secret-guarded `/internal/drain` endpoint on a 15-minute Cloudflare Cron
  Trigger, so backlogged imports/enrichment finish even with no traffic
- Structured Worker/container logs and source-controlled Cloudflare saved-view
  definitions separate stateless API latency from container invocations and
  track both background drains (`docs/OBSERVABILITY.md`)
- Warm by construction — the container's sleep lease is deliberately longer
  than the 15-minute drain cron that wakes it, so it stays up rather than
  cold-starting between crons; browser CORS preflights are answered at the
  Worker edge instead of being proxied into the container at all

## Stack

- **`server/`** — Go API (chi, pgx + sqlc, goose migrations) on PostgreSQL + PostGIS
- **`app/`** — Expo (React Native) app for iOS, Android, and web; MapLibre maps
  with OpenFreeMap tiles (`@maplibre/maplibre-react-native` native,
  `react-map-gl/maplibre` on web) — no map API keys needed; a hi-fi design
  system (Barlow / Barlow Condensed, warm paper-and-ink palette, light and
  dark) runs across every screen

## Local development

Requirements: Go 1.25.7+ (per `server/go.mod`), Node 22 (what CI uses), Docker
(for Postgres+PostGIS), and [sqlc](https://docs.sqlc.dev) if you edit SQL
queries.

```sh
make dev            # start postgres+postgis and run the API on :8080
make seed-osm BBOX=30.19,-97.87,30.40,-97.65   # import OSM courts for a bbox (S,W,N,E)

cd app && npm install
npx expo run:ios    # dev build — Expo Go does NOT work (MapLibre is a native module)
npx expo start --web    # needs app/.env with EXPO_PUBLIC_API_URL=http://localhost:8080
```

`make dev` runs the Go API directly, which skips everything the deployed API
Worker does around it. To run that layer locally instead — the real Worker on
workerd proxying into the Go container, with local R2 and email bindings, no
Cloudflare account and nothing deployed:

```sh
make dev-worker     # http://localhost:8787 (needs Docker with buildx)
```

See [docs/LOCAL_WORKER.md](docs/LOCAL_WORKER.md).

### Tests

```sh
make test           # server: unit tests only (DB-backed tests skip without TEST_DATABASE_URL)
make test-app       # app: jest unit tests across lib/ (pure logic — no component harness)
npm --prefix deploy/api test   # API Worker: vitest (photo security, drain batching, CORS preflight)

# End-to-end smoke over HTTP against a server you already started. `make smoke`
# drives `make dev` on :8080; `make smoke-worker` drives `make dev-worker` on
# :8787 and additionally asserts the Worker's own guarantees (the verification
# token never reaches the client, unsigned photo uploads get a 403, the cron
# drain runs). Both spend requests against RATE_LIMIT_AUTH_PER_MIN, so several
# runs in a row will be throttled on purpose.
make smoke
make smoke-worker

# Server integration tests (store queries + full HTTP API) need a scratch
# Postgres with PostGIS. `make test-int` brings up the compose database,
# creates a throwaway `pullup_test` database, and runs the full suite against
# it (the harness applies migrations and truncates between cases). Requires
# Docker:
make test-int

# Or point at any PostGIS instance yourself — e.g. a second database on an
# already-running compose instance:
TEST_DATABASE_URL=postgres://pullup:pullup@localhost:5432/pullup_test?sslmode=disable \
  make test
```

The API integration tests in `server/internal/api` spin up the real router
against the test database and drive it over HTTP: auth (register/login/
refresh rotation/logout), courts (create/dupe-detect/vote thresholds),
geo-verified check-ins, crowd reports, photos, favorites, push tokens,
flags, and the whole admin/moderation flow. CI runs all of this on every push,
plus the app's typecheck, lint, jest suite and web export, and the API Worker's
generated-bindings check, typecheck, vitest suite and container dry-run build.

The app's jest suite covers `lib/` logic only — there is no component-test
harness (`testEnvironment: "node"`, no testing-library), so anything that has
to render a component is currently verified by hand.

The API runs its migrations automatically on startup. Config is env-based —
see `server/internal/config/config.go`. Runtime secrets are `DATABASE_URL`,
`JWT_SECRET`, `UPLOAD_SIGNING_SECRET`, and `INTERNAL_TASK_SECRET`; signing
secrets must be distinct and at least 32 bytes.

Maps need no API keys: tiles come from [OpenFreeMap](https://openfreemap.org).
`EXPO_PUBLIC_API_URL` is the only app config you need to set; the rest are
optional and fall back to sensible defaults — `EXPO_PUBLIC_WEB_URL` (deep-link
origin, defaults to `https://pull-up.davisbrown.dev`),
`EXPO_PUBLIC_SENTRY_DSN` (error reporting, disabled when unset), and
`EXPO_PUBLIC_IOS_STORE_URL` / `EXPO_PUBLIC_ANDROID_STORE_URL` (the
get-the-app banner, hidden when unset). See `app/.env.example`.

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
the app → `POST /flags`). Admins get a moderation queue (Profile → Profile
settings → "Moderation queue") to review open flags, reject courts, remove
photos, and resolve reports.

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
npx wrangler secret put UPLOAD_SIGNING_SECRET  # a different openssl rand -hex 32
npx wrangler secret put INTERNAL_TASK_SECRET  # auth for the drain cron
npx wrangler email sending enable pull-up.davisbrown.dev   # one-time transactional email setup
```

The API Worker sends verification links through its `EMAIL` binding from
`verify@pull-up.davisbrown.dev`. If another sending domain or canonical web origin is used,
set the `EMAIL_FROM` and `WEB_ORIGIN` Worker vars before deployment and
regenerate `deploy/api/worker-configuration.d.ts` with `npm run types`.

`INTERNAL_TASK_SECRET` is passed to the Go container by the API Worker. It
protects cron, verification-email, and status-aware media cleanup calls; these
internal routes are not exposed by the public Worker. The 15-minute cron drains
OSM/enrichment work and physically removes revoked R2 objects.

Then, from the repo root:

```sh
make deploy-web WEB_ORIGIN=https://pull-up.davisbrown.dev
```

Or push to `main` with the `CLOUDFLARE_API_TOKEN`, `EXPO_PUBLIC_API_URL`, and
`WEB_ORIGIN` repo configuration set (WEB_ORIGIN is a repo variable) and let GitHub Actions deploy both.

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

## License

The pull-up source code is released under the [MIT License](LICENSE).

That covers this repository's own code only. Court data carries the separate
OpenStreetMap terms described above — the ODbL share-alike obligation on the
OSM-derived subset is not waived by the MIT grant.
