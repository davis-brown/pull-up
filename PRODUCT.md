# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

Native-first: iOS and Android are the primary surfaces, and future screens follow each OS's conventions. Web (Expo web, desktop master-detail at ≥1024px) is secondary. Some capabilities are native-only, such as passive geofencing.

## Users

Two groups, weighted equally, and each depends on the other:

- **Regulars**: people who play pickup every week. Before leaving home they check which court has a live run right now, then check in when they arrive. Their check-ins and crowd reports keep the map live.
- **Casual and new players**: people who want to play but don't know where the runs are. They use the live map, the "Runs near you" rail, and "looking to play" demand to find a game, and they can become regulars.

## Product Purpose

RallyFlare finds live pickup basketball: a map of courts showing who's playing right now. Court locations are crowd-sourced and seeded from OpenStreetMap. Live activity comes from geo-verified check-ins and crowd reports. Success means a player opens the map and can trust it enough to drive to a court.

## Positioning

The map shows a real run, not a guess. Check-ins are verified server-side (within 150 m of the court) and expire on their own after 2 hours. Turnout forecasts blend 8-week hourly history with scheduled runs. Planned runs, demand signals ("3 players want to run Thursday evening"), and court chat sit on top of that live layer. The tagline is "powered by players, for players."

## Operating Context

- Used on a phone, often outdoors and on the move: deciding where to go, then checking in at the court.
- Core loops: map → court detail → check in (slide to confirm, party size, "got a ball"); plan or RSVP to a run; report a crowd; record a game, which the losing side confirms.
- Notifications: your-window alerts when a favorite court gets busy, run-planning pushes, and one weekly streak nudge in the user's own timezone.
- Deep links: `/court/<id>` and `?run=<sessionId>` open the native app when it's installed and the web app otherwise.
- Admins moderate in-app (flag queue, admin management, audit log).

## Capabilities and Constraints

- Stack: Expo (React Native) for iOS, Android, and web; Go API on PostgreSQL + PostGIS; deployed on Cloudflare (Worker + container, R2, Neon).
- Maps: MapLibre with OpenFreeMap tiles. No map API keys.
- Auth: verified email/password (email verified with a code), Google, and Apple sign-in.
- Terminology: a **run** is a pickup game session; a **court** is a location; **check-in**, **crowd report**, **RSVP**, **looking to play**, **XP / levels** (Rookie → Legend), **reputation** (a separate track that weights court verification).
- The app has no component-test harness, so rendered UI is verified by hand.

## Brand Commitments

- The name is **RallyFlare**: one word, capital R and F. Never "Rally Flare" or "rallyflare" in copy.
- Onboarding voice is plain and direct, in hooper vernacular ("run", "who's playing right now", "got a ball").

## Evidence on Hand

- None yet. RallyFlare is pre-launch or a personal project, so it has **no user counts, testimonials, ratings, press, or partner logos**. Future work must not invent any of these.
- What can be described truthfully is the product's mechanics (verification radius, expiry, anti-farming caps), as documented in `README.md`.

## Product Principles

Derived from mechanisms already in the product; confirm or edit.

1. **Liveness must be true.** Anything shown as "now" is verified and expires on its own. The product would rather show an empty court than a stale one.
2. **Play never buys power.** XP and levels reward showing up, but they never grant moderation weight, which belongs to reputation alone.
3. **Claims about other people need their consent.** A game result counts only when the losing side confirms it. Private accounts approve their followers.
4. **Reward showing up, not winning.** Win rate is deliberately never gamified. XP is capped and dedup-keyed so it can't be farmed.
5. **Respect attention and location.** Geofencing is opt-in and preceded by a prominent disclosure. Nudges are rare, can be turned off, and follow the user's timezone.
