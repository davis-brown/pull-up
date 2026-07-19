# Submission runbook

Ordered steps to get from a green `main` to builds in both stores. Copy for
listings lives in `listing.md`, reviewer-facing notes in `review-notes.md`,
the manual device walk in `qa-checklist.md`, and deep-link validation in
`deep-links.md` — this file is the order to do things in and the exact
commands.

## 1. One-time account setup (blocks the steps after it)

- [ ] **Sentry** — org `pull-up-cl` / project `pull-up` and the DSN are
      wired into `app/eas.json` (native) and `.github/workflows/deploy.yml`
      (web). One value remains: an org auth token in EAS env as a secret
      named `SENTRY_AUTH_TOKEN` (never committed). The token MUST exist
      before the next preview/production build — with auto-upload no
      longer disabled, a build without it fails at the source-map upload
      step.
- [ ] **Firebase project** (Android push) — create it for package
      `com.pullup.app`, download `google-services.json` into `app/`
      (`app.config.ts` picks it up automatically when present).
- [ ] **Reviewer inbox** — Cloudflare Email Routing forwarding
      `reviewer@davisbrown.dev` to a personal inbox (see
      `review-notes.md`).
- [ ] **App Store Connect / Play Console records** — once the iOS record
      exists, set the Worker dashboard vars `IOS_APP_ID`
      (`<TEAM_ID>.com.pullup.app`) and `APPLE_APP_STORE_ID` (numeric); both
      degrade safely while unset. Android's cert fingerprint is already
      committed in `app/wrangler.jsonc`.

## 2. Screenshots (per `listing.md`, light mode)

Five shots per platform: map with live pins, court detail with live
check-ins, upcoming runs, court chat, onboarding slide 1.

| Store slot | Device | Native output |
|---|---|---|
| iOS 6.9" | iPhone 16 Pro Max simulator | 1320×2868 |
| iOS 6.5" | iPhone 14 Plus simulator | 1284×2778 |
| Play phone | Pixel 8 emulator (or any ≥1080×1920) | — |

Capture at native resolution (no resizing needed):

```sh
xcrun simctl io booted screenshot map-live.png        # iOS, booted simulator
adb exec-out screencap -p > map-live.png              # Android emulator
```

The Play **feature graphic** (1024×500) is a design asset, not a screenshot
— export it from the icon/brand source used for `app/assets/`.

Seed data first so the shots aren't empty: run the API locally, check in at
a court from a second account, plan a run, and post a chat message.

## 3. Builds

```sh
cd app
eas build --profile production --platform ios
eas build --profile production --platform android
```

Both profiles bake in the production API/web origins (`eas.json`); no env
needed at invocation. `autoIncrement` bumps build numbers remotely.

## 4. Manual QA gate

Walk `qa-checklist.md` on a physical iPhone and Android phone **using these
production builds** (internal distribution / TestFlight). Do not submit a
build the checklist didn't run against.

## 5. Submit

```sh
cd app
eas submit --platform ios --latest
eas submit --platform android --latest   # goes to the internal track (eas.json)
```

Before each submission:

- [ ] Fresh reviewer account created and email-verified
      (`review-notes.md`), password pasted into both review-notes fields
- [ ] Listing copy, keywords, and URLs pasted from `listing.md`
- [ ] Data-safety forms answered from `data-collection.md`
- [ ] Background-location review notes pasted from `review-notes.md`

## 6. Post-approval

- [ ] Set `IOS_STORE_URL` / `ANDROID_STORE_URL` Worker vars so the web
      app's "get the app" banner and store badges link to the real listings
- [ ] Validate deep links against the live association files
      (`deep-links.md` — Apple CDN check + Android Statement List tester)
- [ ] Promote the Play internal-track build outward (closed → production)
      as beta feedback allows
