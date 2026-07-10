# Manual QA checklist (pre-submission)

Permission flows and store builds can't run in CI. Walk this on a physical
iPhone and Android phone with a production (`eas build --profile production`)
build before every submission.

## Fresh install / guest

- [ ] First launch shows the 3-slide onboarding; Skip works; it never
      appears again after either exit
- [ ] "Explore courts" lands on the map signed out; location primer sheet
      appears BEFORE the OS location dialog; declining leaves the map usable
- [ ] Guest can browse: map pins, court detail (photos, activity, runs,
      chat history), activity tab
- [ ] Every gated action shows a sign-in CTA: check in, favorite, camera,
      vote, chat composer, RSVP, report crowd, plan run, add court, flag
- [ ] Tapping "Sign in to check in" on a court → sign in → returns to that
      court

## Signed in

- [ ] Register, sign out, sign in (email + each configured OAuth provider)
- [ ] Sign-in does NOT trigger a notification permission dialog
- [ ] First favorite shows the notification primer; accepting fires the OS
      prompt; favoriting still works if declined
- [ ] Check in at a real court (within 150 m); check out; crowd report
- [ ] Plan a run; RSVP from a second account; favoriter gets the push
- [ ] Auto check-in: enabling shows the background-location disclosure
      before the OS prompt (both "Ask me" and "Automatic")
- [ ] Flag a message; block a user (their content disappears); unblock
- [ ] Delete account (two-step) → app returns to signed-out state; /me is 401

## Resilience

- [ ] Airplane mode: map/court/activity show the offline state with Retry;
      recovery works when connectivity returns
- [ ] Empty region: map shows the "No courts here yet" banner
- [ ] Sentry: `Sentry.captureMessage("qa smoke")` temporarily added (or a
      forced crash in a dev build) appears in the Sentry project; remove
      the test call afterwards
- [ ] Legal pages reachable: Profile → Privacy Policy / Terms; same pages
      load on the web app URLs used in the store listings

## Store artifacts

- [ ] Screenshots captured per `listing.md`
- [ ] `eas build --profile production` for both platforms succeeds
- [ ] `eas submit` dry-run reaches the credentials prompt for both stores

## Sharing & deep links (phase 5)

Requires production builds and the association files live on the real domain
(`app/worker.ts` deployed, `EXPO_PUBLIC_WEB_URL` set at build).

- [ ] `https://<domain>/.well-known/apple-app-site-association` returns
      `application/json` and validates via Apple's CDN checker
- [ ] `https://<domain>/.well-known/assetlinks.json` validates via Google's
      Statement List Tester
- [ ] Share a court from the title-row share icon — link is
      `https://<domain>/court/<id>`
- [ ] Share a run (session row + the prompt right after planning) — link
      carries `?run=<id>`
- [ ] On a device with the app installed, tapping a court link opens the app
      directly on that court; a run link opens it with the run surfaced to the
      top and accented ("Shared with you")
- [ ] On a device without the app, the same link opens the web app on that
      court
- [ ] Paste a court link into iMessage/WhatsApp — it unfurls with the court
      name, live-status line, and a photo
- [ ] A court with no photos still unfurls (brand image) and still opens
- [ ] An expired/unknown `?run=` id opens the plain court page (no error)
- [ ] Web app (mobile browser) shows the "get the app" banner; "Get it" opens
      the store; the close button dismisses it and it stays dismissed on reload
- [ ] iOS Safari shows the native Smart App Banner on a court page

## Social & player identity (phase 6)

- [ ] Tapping a name in court chat, the checked-in list, and "planned by"
      opens that player's profile
- [ ] A profile shows aggregate stats only — no court names, no check-in
      times, no location history anywhere on it
- [ ] Follow a user; the follower/following counts and lists update; unfollow
      works and is idempotent
- [ ] Following count/list respects blocking: block a followed user → the
      follow disappears both ways and the Follow button is gone
- [ ] Plan a run; a follower who is NOT a court favoriter receives exactly one
      "run planned" push (no duplicate for someone who is both)
- [ ] Set an avatar from Profile → Edit; it appears on your profile, in chat,
      and in follower lists; remove it → falls back to initials
- [ ] Edit display name from Profile; it updates across surfaces
- [ ] Report a profile (flag entity "user"); an admin can clear the avatar
- [ ] Guest (signed out) can view a profile and its lists; Follow shows a
      "Sign in to follow" CTA
