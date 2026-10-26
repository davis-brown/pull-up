# pull-up — App Store release audit

Date: 2026-10-26. Repository: `davis-brown/pull-up`. Base: `1397d78`. Local branch: `release/app-store-readiness`.

**Verdict: the App Review code safeguards are implemented locally, but this is not yet a submission-ready or fully validated release.** Apple account configuration, review materials, native testing, PostGIS integration testing, and the dependency decision below remain open. No push, PR, EAS build/submit, deployment, secret change, or cloud-resource change was performed.

References below are repository-relative `file:line` locations. **code fix (me)** identifies local implementation work; **needs the user** identifies account access, approvals, operational ownership, or factual/legal decisions.

## Blockers

### B1. Apple membership, identity, signing and store record — OPEN — needs the user

Reserve or confirm the bundle ID before the first release. `com.pullup.app` is configured, but its availability and ownership cannot be established from source. Create/confirm the Apple Developer membership, App Store Connect app record, agreements, signing credentials, and Sign in with Apple capability. Confirm ownership/access to the existing EAS project. Choose the seller identity and territories.

Evidence: `app/app.config.ts:43`, `app/app.config.ts:52`, `app/app.config.ts:200`, `app/eas.json:39`. Lowercase “pull-up” is a branding choice, not itself a rejection. The branch now uses version `1.0.0` and is iPhone-only.

### B2. Apple-token revocation on account deletion — FIXED LOCALLY — code fix (me)

Previously only the app's account/session records were deleted. Native Apple sign-in now sends the authorization code; the API exchanges it, verifies the returned Apple identity matches the signer, and stores the refresh token using AES-GCM with a dedicated key. Account creation/token storage are transactional. Deletion atomically queues the encrypted token and removes account data; immediate background work and the existing hourly drain retry Apple revocation. Successful revocation erases the queued token. Apple outages do not block account deletion.

Signed Apple notifications validate signature, issuer and audience. Relay changes are recorded; consent revocation invalidates refresh sessions; an Apple-account deletion invokes account deletion. Duplicate/out-of-order events are guarded by event time. Existing access JWTs have their existing short expiry; refresh revocation does not invalidate an already issued JWT immediately.

Evidence: `app/components/OAuthButtons.tsx:94`, `server/internal/api/phase2_handlers.go:243`, `server/internal/auth/apple_tokens.go:64`, `server/internal/api/compliance_handlers.go:19`, `server/internal/api/apple_revocations.go:7`, `server/internal/api/apple_notifications.go:14`, `server/internal/auth/oauth.go:156`, `server/migrations/00031_apple_tokens.sql:1`.

### B3. Activate Apple-token management and notifications — OPEN — needs the user

Configure server-side `APPLE_AUDIENCES` and `APPLE_CLIENT_ID` for the chosen app identity, `APPLE_CLIENT_SECRET` (a developer-signed Apple client-secret JWT), and a separate random **32-byte** `APPLE_TOKEN_ENCRYPTION_KEY`. These are server secrets, never `EXPO_PUBLIC_*` values. Renew the client-secret JWT before expiry; preserve the encryption key and client ID while encrypted tokens or revocation jobs exist. Key rotation needs a migration plan.

Register `https://pull-up-api.davisbrown245.workers.dev/api/v1/auth/apple/notifications` on the primary App ID after an approved deployment. Confirm actual delivery, revoke/delete/re-register behavior, and retry recovery. Earlier Apple accounts without a captured provider token must reauthorize to capture one; deletion still works and the app links to Apple Account settings for manual disconnection. Apple sign-in returns an availability error until token-management configuration is complete.

Evidence: `server/internal/config/config.go:35`, `deploy/api/src/index.ts:22`, `app/.env.example:9`, `app/app/profile-settings.tsx:637`.

### B4. Filtering, image publication, reporting, blocking and moderation — FIXED LOCALLY — code fix (me)

Production previously allowed text through when the classifier was missing, down, or returned an unknown answer. It now requires a safe verdict; unavailable checks return a retryable error. Coverage includes chat, run notes, crowd-report notes, court names/addresses/fee notes, and profile names, including first OAuth registration.

Court photos previously became public as soon as upload finalized, and avatars bypassed prior review. New uploads now remain private in a human review queue. Administrators get signed, five-minute previews and approve or reject images; ordinary reads cannot access pending images. Pending objects survive cleanup while under review; rejected/replaced/deleted objects enter the existing deletion queue.

The earlier branch commits expose report/block actions on the app's UGC surfaces. Added moderator removal actions for reports, messages and runs, and account suspension that hides/removes the player's content and prevents authenticated participation. Suspended players retain access to account deletion. The last-administrator guard no longer prevents permanent account deletion.

Evidence: `server/internal/api/moderation_helpers.go:62`, `server/internal/api/court_handlers.go:402`, `server/internal/api/media_review_handlers.go:16`, `server/internal/api/internal_handlers.go:156`, `server/internal/api/user_handlers.go:170`, `server/internal/api/content_moderation.go:10`, `server/internal/api/middleware.go:36`, `server/migrations/00030_media_review.sql:1`, `app/app/admin/index.tsx:285`, `app/components/CourtChat.tsx:91`, `app/components/CourtSessions.tsx:149`.

### B5. Moderation operations and privacy/support publication — OPEN — needs the user

Assign a moderator and a response process before opening UGC. Review existing public content as well as the new pending queue. Confirm that `contact@davisbrown.dev` is a monitored inbox and approve the privacy/terms text, provider protections and actual backup retention. Source cannot verify those operational/legal facts.

Public local routes exist at `/privacy`, `/terms`, and `/support`, with in-app links. Following deployment approval, verify the rendered anonymous pages at `https://pull-up.davisbrown.dev/privacy`, `/terms`, and `/support`; a SPA HTTP 200 alone does not prove that the correct page is visible. Enter the URLs in App Store Connect.

Evidence: `app/app/support.tsx:24`, `app/app/privacy.tsx:21`, `app/app/terms.tsx:18`, `app/app/profile-settings.tsx:608`.

### B6. Review account, proximity-dependent features and backend availability — OPEN — needs the user

Provide a non-admin demo account and current review credentials through App Store Connect, plus review instructions and a video showing real check-in and opt-in background behavior. Check-ins require proximity to a real court; there is no hidden review bypass. Explain how a reviewer can assess that feature remotely without misleading them.

A read-only live health request returned **HTTP 200 in 2.3 seconds** during this audit. Its starting state was unknown, so this does **not** prove cold-start performance. The container sleeps after five minutes and the client timeout is 15 seconds. Confirm a genuinely cold request using service logs and test the full sign-in/map/check-in flow before review; adjust only if measured behavior requires it.

Evidence: `deploy/api/src/index.ts:90`, `app/lib/api.ts:18`, `server/internal/api/checkins_test.go:1`, `app/lib/geofencing.ts:150`.

### B7. Signed native build and database validation — OPEN — needs the user

Authorize the next build/deployment phase separately. Run migrations 00030–00032 on a disposable PostGIS test database and execute the integration suite before any production rollout. This machine has no configured `TEST_DATABASE_URL`, PostgreSQL service, or Docker command; **121 integration tests were skipped**, including the new database-backed media, suspension, consent and deletion-queue checks.

On a signed iPhone build/TestFlight, verify Apple sign-in with a real and hidden email, account deletion, moderation previews/approval, denied permissions, background arrival/exit, push delivery and Sentry crash symbolication. Native archive/device validation was not performed on this Windows host.

Evidence: `server/internal/api/api_test.go:50`, `server/internal/api/release_integration_test.go:1`, `server/migrations/00030_media_review.sql:1`, `app/eas.json:27`.

### B8. Final privacy manifest, labels and age questionnaire — OPEN — needs the user

A privacy-manifest declaration is configured for four required-reason API categories and nine collected data types. The installed React Native/Expo manifest reasons were inspected. The app declarations include location, user content, gameplay, push/device identifiers and Sentry crash data, with no tracking. Crash data is conservatively marked linked because stripping the account does not establish that all device association is absent.

Generate the **archive's** Xcode privacy report and reconcile every SDK manifest and App Privacy answer. Configuration introspection cannot certify a signed archive. Complete the current age-rating questionnaire accurately for public profiles, feeds, messaging and UGC, and resolve territorial age-assurance/trader decisions before choosing launch regions.

Evidence: `app/app.config.ts:70`, `app/app.config.ts:92`, `app/app/_layout.tsx:41`, `app/app/privacy.tsx:34`. Cross-reference the Researcher report, but verify time-sensitive submission requirements in App Store Connect at submission time.

## Should-fix

- **S1 — FIXED LOCALLY — code fix (me): permission declarations and background purpose.** Removed unused camera, microphone, motion, Face ID and background-fetch declarations; retained location for opt-in geofencing. This installed Expo module explicitly checks for `UIBackgroundModes: location` before starting geofencing (`app/node_modules/expo-location/ios/LocationModule.swift:266`). Removing it would break this implementation. The app uses region monitoring and a one-shot position for verification, not continuous tracking. Denied location falls back to a usable map/search. Explain this exact feature in review notes and test on device. Refs: `app/app.config.ts:23`, `app/app.config.ts:62`, `app/plugins/withoutBackgroundFetch.js:1`, `app/lib/geofencing.ts:235`, `app/app/location-disclosure.tsx:17`, `app/app/(tabs)/index.tsx:83`.
- **S2 — FIXED LOCALLY — code fix (me): sign-in parity and terms.** Apple is available on both iOS sign-in and registration paths. Both account-creation paths require explicit terms/content-processing consent. Existing accounts receive a versioned acknowledgement; production text posting checks recorded consent before sending content to Workers AI. Legal pages and account deletion remain accessible without accepting. Refs: `app/app/(auth)/register.tsx:81`, `app/app/(auth)/login.tsx:78`, `app/components/CommunityConsent.tsx:13`, `server/internal/api/content_consent.go:5`, `server/internal/api/auth_handlers.go:58`.
- **S3 — FIXED LOCALLY — code fix (me): location wording.** Removed the absolute “location history is never stored” claim from permission copy, disclosure and settings. Check-in history is stored; continuous GPS history is not recorded by this implementation. Refs: `app/app.config.ts:26`, `app/app/location-disclosure.tsx:22`, `app/app/profile-settings.tsx:522`, `app/app/privacy.tsx:37`.
- **S4 — VERIFIED IN CODE / DELIVERY OPEN — needs the user: Apple relay emails.** No Apple-domain allowlist rejects `privaterelay.appleid.com` or `private.icloud.com`; signed verified email claims are preserved. Added tests for both. Synthetic `users.pullup.local` addresses are shown as a provider label, not an inbox. Register/verify the real sending domain with Apple's relay service and test delivery if sending email to relay accounts. Refs: `server/internal/auth/oauth.go:105`, `server/internal/auth/apple_events_test.go:50`, `app/lib/account.ts:12`, `app/lib/account.test.ts:5`.
- **S5 — CONFIGURED / DEVICE CHECK OPEN — needs the user: push and Sentry.** EAS project ID, notification plugin and production public Sentry DSN exist. Permission requests are contextual and ordinary browsing does not require push. Verify APNs credentials and distribution entitlement, delivery and opt-outs. Local introspection shows the expected development APNs entitlement; the signed distribution build must be checked separately. Configure source-map upload credentials through the appropriate secret channel; verify a symbolicated test event and actual retention. Refs: `app/app.config.ts:169`, `app/app.config.ts:188`, `app/eas.json:27`, `app/lib/push-registration.ts:60`, `app/app/_layout.tsx:41`.
- **S6 — FIXED LOCALLY — code fix (me): transport security.** Generated iOS configuration now disables arbitrary loads while retaining local-development networking. Production origins use HTTPS. Ref: `app/app.config.ts:65`.
- **S7 — OPEN — code fix (me), needs the user for native validation/upgrade decision: Expo dependency advisories.** `npm audit --omit=dev` reports **11 affected dependency entries: 8 high, 3 moderate**. Several entries inherit the same underlying tooling advisory; this is not eleven independent device vulnerabilities. The underlying packages include `node-forge` (no patched published release found), Zod 3 in Expo tooling, Metro's `image-size`, and the runtime router's `query-string/decode-uri-component` path. Compatible Metro updating did not remove them. Proposed fixes include major SDK/API changes, and substituting ESM query-string into Expo 57's CommonJS namespace imports would be incompatible. No forced upgrade/downgrade was applied. Plan a supported SDK/toolchain upgrade, validate routing with malformed URLs and native behavior, and reassess the advisories before release. Refs: `app/package-lock.json:7346`, `app/package-lock.json:8941`, `app/package-lock.json:10227`, `app/package-lock.json:14694`, `app/package-lock.json:18676`. Advisory links below.
- **S8 — FIXED LOCALLY — code fix (me): Worker tooling advisories.** Updated Wrangler to 4.153.0 and compatible Workers types. Full Worker dependency audit now reports **zero vulnerabilities**. Ref: `deploy/api/package.json:18`.

## Nice-to-have

- **N1 — needs the user:** final icon/launch-screen visual sign-off and real in-use store screenshots. Both existing raster assets are 1024×1024; the supplied icon has an alpha channel, while Expo's installed iOS icon generator explicitly removes transparency for the default icon. Verify the generated archive icon rather than treating the source channel alone as a blocker. Splash artwork may be transparent. No store screenshots were supplied or produced. Refs: `app/assets/icon.png`, `app/assets/splash-icon.png`, `app/app.config.ts:137`; installed generator `app/node_modules/@expo/prebuild-config/build/plugins/icons/withIosIcons.js:198`.
- **N2 — code fix (me):** reduce the 32 existing React hook/ref lint warnings and pin/document a supported Node LTS. They are unchanged from the initial lint result and are not represented as clean lint.
- **N3 — needs the user:** configure the real App Store URL, association identifiers and marketing metadata once the app record exists. Refs: `app/.env.example:23`, `app/wrangler.jsonc:26`, `app/lib/og.ts:12`.

## Marketing facts requested by Chief of Staff

1. **“Thousands of courts” — UNVERIFIED; do not use as a current inventory claim.** The repository has no fixed court inventory count or static court-row seed list. It imports OpenStreetMap courts dynamically as regions are explored. Map queries are capped and trigger seeding, so a viewport response is neither a global count nor a strictly observational inventory operation. No production database credentials were accessed. Safe copy: “Discover basketball courts from OpenStreetMap and the community.” To substantiate a number, an authorized database operator should run a read-only count such as `SELECT count(*) FROM courts WHERE status <> 'rejected';`, date it, and separately count verified courts if the copy implies verification. Refs: `server/internal/seeder/seeder.go:131`, `server/internal/seeder/seeder.go:232`, `server/internal/api/court_handlers.go:282`, `server/migrations/00002_seed_regions.sql:1`.
2. **“Your location history is never stored” — FALSE AS AN ABSOLUTE CLAIM (confirmed in code).** Check-ins retain the court, timestamps and distance; a court has known coordinates, so this is a history of court visits. Migration 00014 drops exact reported check-in coordinates, and current inserts store distance rather than coordinates. Safe copy: “We don't record continuous GPS history. Check-ins save the court, time and distance; exact check-in coordinates are discarded after verification.” Provider/access-log retention and whether production has all migrations require operational confirmation. Refs: `server/migrations/00014_security_hardening.sql:37`, `server/internal/store/queries/activity.sql:28`, `server/internal/store/queries/phase2.sql:107`, `app/app/privacy.tsx:37`.

## Verification and limits

- App: `npm run typecheck` passed; `npm test -- --runInBand` passed **23 suites / 210 tests**; `npm run lint` passed with **0 errors / 32 warnings**.
- Go 1.27.3: `go test ./...` passed **201 tests**, with **121 skipped** for the missing test database; `go vet ./...` passed.
- API Worker, Node 24.22.1: typecheck and Vitest passed **3 files / 22 tests** after the tooling update; full npm audit reports **0 vulnerabilities**.
- Local Expo web export passed. It was written outside the repository to `C:\Users\davis\OpenBot\Shared\Projects\pull-up-release-web`; this is not a deployment.
- Expo configuration introspection passed: version 1.0.0, iPhone-only, only `location` background mode, SIWA entitlement, no unused camera/microphone/motion/Face ID purpose strings, arbitrary loads disabled, four privacy API categories and nine data categories. An introspected configuration is not a built/signed application.
- New checks cover Apple exchange/revocation/encryption tampering, wrong notification issuer/audience, both relay domains, unavailable/unknown moderation, consent-before-classification, preview-capability separation, and database-backed review/suspension/deletion/consent contracts. Database-backed checks compiled but did not execute.
- No App Store Connect, APNs, Sentry credential, email inbox, production database, native archive, physical device, or actual cold-start state was authenticated/verified.

## Google Play gaps (secondary)

**needs the user:** complete the developer account, Data safety, current target-SDK validation, background-location declaration/video, signing/Firebase setup and any account-specific testing requirement. Supply a public deletion-request URL suitable for the Play listing; the local support page currently gives signed-in deletion instructions and a contact path, but submission suitability needs review. Existing Android background-location disclosure and in-app deletion should be tested on a signed Android build. Refs: `app/app.config.ts:110`, `app/app.config.ts:126`, `app/app/location-disclosure.tsx:1`, `app/app/support.tsx:54`.

## Local commits

- `a509284` — iOS permission cleanup, version and privacy declaration.
- `6a8245a` — terms acceptance on registration.
- `ae31bab` — reachable report/block controls.
- `758de5c` — public Support page and synthetic-email labels.
- `5c8122e` — API safeguards, image review, consent, suspension, Apple grants/notifications, migrations, tests and Worker dependency fix.
- `7da11c1` — app moderation/consent UI, Apple authorization-code transport and corrected privacy copy.
- The documentation commit containing this audit is listed in the final handoff.

## Sources and research cross-check

The Researcher's `C:\Users\davis\OpenBot\Shared\Research\pull-up-app-store-requirements.md`, section 0, was cross-checked for all eight risks: support, background location, UGC, age metadata, review access/cold starts, Apple revocation, relay emails and privacy manifest. Product dates, device specifications and territorial legal thresholds in that report are not independently certified here.

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — UGC, app completeness, login and privacy review.
- [Apple account deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion) and [TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple) — deletion and revocation.
- [Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens), [revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens), and [notification configuration](https://developer.apple.com/help/account/capabilities/enabling-server-to-server-notifications/).
- [Expo privacy manifests](https://docs.expo.dev/guides/apple-privacy/) — configuration and archive reconciliation.
- [URI decoding advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), [image parser advisory](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

