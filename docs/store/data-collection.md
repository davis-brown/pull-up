# Data collection answers (Apple privacy nutrition / Play data safety)

Answers derive from the privacy policy (`app/app/privacy.tsx`). Update both
whenever data practices change.

| Data | Collected? | Linked to identity | Purpose | Notes |
|---|---|---|---|---|
| Email address | Yes | Yes | Account management | Sign-up / OAuth |
| Name (display name) | Yes | Yes | App functionality | Shown on UGC |
| Precise location | Yes | No | App functionality | Used transiently for nearby results and check-in distance; exact coordinates are discarded |
| Coarse location | Yes | No | App functionality | Map centering and nearby-court ranking |
| Photos | Yes (user-chosen) | Yes | App functionality | Court photos users upload |
| User content (chat, reports) | Yes | Yes | App functionality | Moderated, flaggable, blockable |
| Other user content (game results, availability posts) | Yes | Yes | App functionality | A game result names other players; it stays private to participants until the losing side confirms it, and unconfirmed results are deleted after 48h |
| Optional profile details | Yes (user-chosen) | Yes | App functionality | Jersey number, position, height, style tags, skill level, availability windows; shown publicly, removable anytime |
| App activity (XP, level, streaks) | Yes | Yes | App functionality | Derived from check-ins and games; level shown publicly (hidden from non-followers on private accounts) |
| Device time zone | Yes | Yes | App functionality | IANA zone name only (e.g. "America/Chicago"), so reminders fire at a sensible local hour. Not location |
| Crash data | Yes | No | App functionality | Sentry; device model, OS, stack trace |
| Identifiers / advertising data | No | — | — | No ads, no tracking SDKs |

Store-form specifics:

- **Apple "Data Used to Track You":** none.
- **Apple "Data Linked to You":** email, name, photos, user content, profile
  details, app activity (XP/level/streaks), device time zone.
- **Apple "Data Not Linked to You":** location, crash data.
- **Play data safety:** all collection marked "required for app
  functionality", no data shared with third parties, data encrypted in
  transit, account + data deletable in-app (Profile → Profile settings →
  Delete account) and
  via the web app.
