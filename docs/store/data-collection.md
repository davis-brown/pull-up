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
| Crash data | Yes | No | App functionality | Sentry; device model, OS, stack trace |
| Identifiers / advertising data | No | — | — | No ads, no tracking SDKs |

Store-form specifics:

- **Apple "Data Used to Track You":** none.
- **Apple "Data Linked to You":** email, name, photos, user content.
- **Apple "Data Not Linked to You":** location, crash data.
- **Play data safety:** all collection marked "required for app
  functionality", no data shared with third parties, data encrypted in
  transit, account + data deletable in-app (Profile → Profile settings →
  Delete account) and
  via the web app.
