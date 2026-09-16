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

*(Empty — pick the next item from Later.)*

---

## Next

*(Empty.)*

---

## Later

- **Coverage & ingestion ops** · *data* · L — periodic OSM re-sync for new
  courts, near-duplicate dedup, and region-backfill tooling (today `osmseed` is
  a one-shot).
- **Run/session scheduling polish** · *liveness* · M — recurring runs, reminders,
  RSVP nudges.
- **Personalized surfacing** · *discovery* · M — "your courts," recents, ranking
  that blends distance with current liveness.
- **Web preview & store refresh** · *platform* · S–M — extend the OG/deep-link
  work in `app/worker.ts` and refresh the store listing (`docs/store/`).

---

## Recently shipped

- **Performance & accessibility pass** (item 8) — baseline first, recorded in
  `docs/OBSERVABILITY.md`: median 189ms / p95 616ms / p99 1268ms over the prior
  week. Four fixes came out of it. `ApiContainer.sleepAfter` was exactly equal
  to the `*/15` cron interval, so the cron that wakes the container every 15
  minutes raced the 15-minute sleep and roughly half of requests paid a cold
  start; a 20m lease is always re-upped, at the cost of the container now
  billing as warm ~100% of the time rather than ~50%. Browser preflights were
  proxying all the way to the container — the Worker logged *more* `OPTIONS`
  than actual searches — and are now answered at the edge from a mirror of the
  Go CORS config, with `Access-Control-Max-Age` raised 600 → 7200. On the
  client, `useCourtsInBBox` gained `keepPreviousData` (every pan was blanking
  the pin layer while the new bbox loaded) and a 30s `staleTime`, and the
  desktop court list moved from an unvirtualized `ScrollView` + `.map()` to a
  `FlatList` with a memoized row. A11y went in at the primitive level:
  `Button`, `Chip`, `SegmentedToggle`, `Field`, `FullScreenLoader` and
  `ErrorText` had no roles, labels or state at all, which is most of the app's
  controls transitively; sub-44pt targets on `Chip` and the segmented control
  were fixed with `hitSlop` rather than by inflating a deliberately dense
  design. Two things were deliberately left out — bbox quantization for cache
  reuse (needs coarse enough rounding to visibly clip the viewport before it
  pays), and component tests for the a11y props, which this repo has no harness
  for (`testEnvironment: "node"`, no testing-library). Shipped 2026-07-27.
- **Observability cleanup** (item 7) — structured per-queue `background_drain`
  cron events, JSON container logs, and a runbook in `docs/OBSERVABILITY.md`.
  Verified live: each cron emits one event per queue, filterable on `event`,
  `queue`, and `outcome`, with `duration_ms` and the per-queue counters
  queryable as numbers. Two corrections came out of the live check — the
  runbook's invocation-metadata keys were `$cloudflare.*` and are really
  `$workers.*`, and the three saved views had to be created by hand because
  the deploy token can read the observability queries API but not write it.
  All three now exist under Observability → Queries. Shipped 2026-07-27.
- **Search by name and area** (item 6) — discovery search now combines indexed,
  location-biased court-name matches with submit-only Nominatim area results.
  Selecting a court opens the existing detail flow; selecting an area fits the
  map and reuses viewport loading and OSM seeding. Provider calls are
  courtesy-limited and cached, and court results remain available during a
  geocoder outage. Shipped 2026-07-26; a zero-result area search was returning
  `"areas": null` and crashing the sheet, fixed 2026-07-27.
- **OSM attribute backfill** (item 1) — the enricher now reads each OSM-sourced
  court's own tags (surface, lighting, hoops, covered, access, fee,
  opening_hours, …) and fills null columns, reusing the ingestion parser and
  never clobbering. Shipped 2026-07-26.
- **Metadata filters & display** (item 2) — *already present when the roadmap
  was written.* Server (`CourtsInBBox`), client (`matchesFilters`), and the
  `FilterSheet` UI already filter on lit/covered/public/free/fenced/water/
  toilets/parking/hoops/surface, with quick presets; court detail already shows
  opening_hours/website/description/access/fee. The only unbuilt piece — a true
  "open now" filter — was deliberately declined (`court/[id]/index.tsx` notes it
  is "deliberately not an opening_hours parser"): it can't run in the SQL filter
  path, needs per-court timezone, and coverage is sparse. Left out on purpose.
- **Local integration tests** (item 3) — `make test-int` brings up the compose
  PostGIS, creates a throwaway `pullup_test` database, and runs the full suite
  (the harness applies migrations + truncates between cases). Mirrors CI.
  Shipped 2026-07-26.
- **Tap-to-confirm corrections** (item 4) — the Phase 14 conditions model
  (recent-window majority, no per-edit moderation) already covered rim/net/
  lighting/surface/water/toilets; extended it to covered/fenced/parking/access/
  fee/hoop_count so the crowd can correct the OSM-backfilled values. Also
  collapsed the now-longer conditions UI behind "add more details". Shipped
  2026-07-26.
- **Forecast confidence** (item 5) — the hourly turnout forecast and its
  "busiest 5–8 PM" line already existed; the missing piece was a confidence
  signal. The per-court week count (already computed as the average's divisor)
  is now surfaced as `weeks`, and `PopularTimes` caveats a thin forecast
  ("Based on 2 weeks of check-ins"). Game history was intentionally left out —
  games are win/loss records, not a presence signal. Shipped 2026-07-26.

## How this doc is maintained

- One item = one design-gate decision. Don't start a **Now** item's major
  implementation without confirming direction; don't push without the pre-push
  gate.
- When an item ships, remove it here and let the commit be the record; when
  priorities shift, reorder rather than letting the doc rot.
- Effort tags are rough: **S** ≈ a sitting, **M** ≈ a focused day or two,
  **L** ≈ multi-session.
