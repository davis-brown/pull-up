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
