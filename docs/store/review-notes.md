# Reviewer notes (paste into App Review notes / Play review field)

## Demo account

Create a fresh reviewer account before each submission (any email works —
there is no email verification):

- email: `reviewer@pullup.app`  password: `<generate per submission>`

Or reviewers can register in-app in ~10 seconds. Browsing the map, courts,
activity, runs, and chat requires no account at all (guest mode).

## Background location (iOS Always / Android ACCESS_BACKGROUND_LOCATION)

Used ONLY for the optional auto check-in feature (Profile → Auto check-in,
off by default):

1. The user opts in from their profile; a prominent in-app disclosure
   (`app/app/location-disclosure.tsx`) explains the feature BEFORE the OS
   permission prompt.
2. The device then monitors geofences around nearby courts. On arrival the
   app either prompts ("check in?") or checks in automatically, per the
   user's setting.
3. No location history is collected or stored; the only artifact is a
   check-in at a known court, identical to a manual one.

To demo: Profile → Auto check-in → "Ask me". The disclosure sheet appears
first; accepting requests Always location.

## UGC moderation (App Store 1.2 / Play UGC policy)

- Terms of Service in-app and on the web (`/terms`); registration implies
  agreement.
- Every content type (courts, photos, crowd reports, chat messages, planned
  runs) has a flag/report control in the UI (`POST /flags`).
- Users can block other users (chat message → Block; managed in Profile).
  Blocked users' content disappears for the blocker immediately.
- Admins review flags in an in-app moderation queue and can remove content;
  every admin action is audit-logged.
- Contact for anything reviewers find: contact@davisbrown.dev.

## Account deletion (5.1.1(v) / Play requirement)

Profile → Delete account (two-step confirm). Also available on the web app
without reinstalling. Removes the account and all personal data; community
court data survives with the submitter detached.
