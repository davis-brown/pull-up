# pull-up roadmap

Where the app is going after the phase-1–20 build-out and the Photos v2 epic.
This is a living doc — items move up as they're picked, and land in git history
when shipped. It exists so "what's next" is never reconstructed from commit
archaeology again.

## Guiding principles

These predate this roadmap and constrain every item below (see the phase-workflow
notes):

- **Moderation load stays near zero.** This is a solo-developer app. Prefer
  automated, OSM-sourced data and *structured* crowd input (tap-to-confirm,
  aggregated) over free-text or new photo/social surfaces that need policing.
- **Automated/OSM-first.** If OpenStreetMap or another open service already
  knows a fact about a court, ingest it rather than asking users.
- **Structured over free-text.** Confirmations and aggregated signals beat
  open input the app has to moderate and normalize.
- **Solo-dev throughput.** Two approval gates per phase (design direction, then
  pre-push); execute continuously between them. No heavy social (crews, DMs) —
  that pivot was deliberate.

Themes prioritized for this roadmap: **court data & coverage**, **discovery &
filtering**, **liveness & conditions**, and **reliability & polish**.

## Context: what already exists

So items below don't re-propose shipped work.

- **Courts** carry rich metadata columns already: `hoop_count`, `indoor`,
  `surface`, `lighting`, `rim_type`, `net_type`, `covered`, `fenced`, `access`,
  `fee`, `is_public`, `opening_hours`, `website`, `description`,
  `drinking_water`, `toilets`, `parking`. Many are **null in practice** —
  the schema is ahead of the data.
- **Enrichment** (`server/internal/enrich`) lazily fills, per court: a
  Nominatim address, Wikimedia Commons + Mapillary photos (cached read-through
  into R2, Photos v2), and Overpass amenities (water/toilets/parking). It does
  **not** read the court's own OSM tags for surface/lighting/hoops/etc.
- **Discovery** filters (`app/lib/court-filters.ts`): `indoor`, `has_hoops`,
  `water`, `surface`, `min_hoops`, plus quick presets. Search is map/bbox only.
- **Liveness**: manual + geofenced check-ins, planned runs/sessions (run
  intents), pickup games (unconfirmed expire after 48h), busy-time forecasts,
  structured court conditions.
- **Engagement**: XP/levels, badges, leaderboards, follows/feed, streaks with
  throttled push nudges.
- **Platform**: Go + PostGIS on Cloudflare Containers + Neon; a Worker fronts
  the container; R2 for photos; a cron drains enrichment + object-deletion
  queues; Sentry for errors.

---

## Now

Highest-leverage, well-aligned, ready to start.

### 1. Backfill court attributes from OSM during enrichment · *data* · M
The enricher already queries Overpass for nearby amenities but throws away the
court's own tags. Read `surface`, `sport`, `hoops`, `lit`, `covered`, `access`,
`fee`, `opening_hours` from the court node/way and fill the matching null
columns — never clobbering existing values, exactly like
`SetCourtAmenitiesIfNull`. This turns the already-present-but-empty schema into
real data with **zero** added moderation, and unblocks item 2.

### 2. Surface the metadata as filters · *discovery* · M
Once courts actually carry `lighting`/`covered`/`access`/`fee`, expose them:
add filters for lit, covered, public-access, and fee-free, plus an **"open now"**
filter derived from `opening_hours`. Wire a couple into `FilterSheet` presets
(e.g. a "Lit courts" preset for the night use-case). This is the user-facing
payoff for item 1.

### 3. Make DB-backed tests runnable locally · *reliability* · S–M
Every integration test skips without `TEST_DATABASE_URL`, so a solo dev can't
run them before pushing (the Photos v2 resolve/deletion tests only execute in
CI). Give `make test-int` a disposable Postgres+PostGIS (docker-compose or an
ephemeral Neon branch) so the meaningful coverage runs on demand, not blind.

---

## Next

### 4. Tap-to-confirm court corrections · *data* · M–L
Let users confirm or correct a court's `surface`/`hoop_count`/`lighting` through
aggregated tap input (the conditions model), not free text. Confidence comes
from agreement across users; nothing needs per-edit review. Closes the loop
where OSM is wrong or missing.

### 5. Forecast accuracy pass · *liveness* · M
The busy-time forecast exists; tune it against accumulated check-in/game history,
attach a confidence signal, and show "typically busy around …" on court detail.

### 6. Search by name and area · *discovery* · M
Add text search and area jumps ("courts in <neighborhood>") on top of the
current map/bbox-only discovery, so a court is findable without already knowing
where it is on the map.

### 7. Observability cleanup · *reliability* · S
Fix or document the pull-up-api double-logging (filter `executionModel=stateless`
so latency percentiles are meaningful) and add a couple of views for the
enrichment and object-deletion drains, which currently have no dashboard.

---

## Later

- **Coverage & ingestion ops** · *data* · L — periodic OSM re-sync for new
  courts, near-duplicate dedup, and region-backfill tooling (today `osmseed` is
  a one-shot).
- **Run/session scheduling polish** · *liveness* · M — recurring runs, reminders,
  RSVP nudges.
- **Personalized surfacing** · *discovery* · M — "your courts," recents, ranking
  that blends distance with current liveness.
- **Performance & accessibility pass** · *reliability* · M — map/list perf, cold
  starts, and an a11y audit across screens.
- **Web preview & store refresh** · *platform* · S–M — extend the OG/deep-link
  work in `app/worker.ts` and refresh the store listing (`docs/store/`).

---

## How this doc is maintained

- One item = one design-gate decision. Don't start a **Now** item's major
  implementation without confirming direction; don't push without the pre-push
  gate.
- When an item ships, remove it here and let the commit be the record; when
  priorities shift, reorder rather than letting the doc rot.
- Effort tags are rough: **S** ≈ a sitting, **M** ≈ a focused day or two,
  **L** ≈ multi-session.
