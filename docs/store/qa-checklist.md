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
- [ ] Legal pages reachable: Profile → Profile settings → Privacy Policy /
      Terms; same pages load on the web app URLs used in the store listings

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
- [ ] Set an avatar from Profile → Profile settings; it appears on your profile,
      in chat, and in follower lists; remove it → falls back to initials
- [ ] Edit display name from Profile → Profile settings; it updates across
      surfaces
- [ ] Report a profile (flag entity "user"); an admin can clear the avatar
- [ ] Guest (signed out) can view a profile and its lists; Follow shows a
      "Sign in to follow" CTA

## Runs feed & friends presence (phase 7)

- [ ] Signed out: the Activity tab shows only the nearby-courts list (no feed
      header), exactly as before
- [ ] Signed in with no follows/favorites: the Activity tab shows the "Follow
      players and favorite courts to fill your feed" prompt above the list
- [ ] Follow a player who plans a run (or favorite that court): the run appears
      under "Upcoming runs"; tapping it opens the court with the run highlighted
- [ ] Your own upcoming runs do NOT appear in your feed
- [ ] Mutual follow (you both follow each other) + the friend checks in: they
      appear under "Friends here now" with court + "Xm ago"; tapping opens the
      court
- [ ] A one-directional follow (only you follow them) does NOT surface their
      live check-in
- [ ] Block a friend: they disappear from "Friends here now" and their runs
      leave your feed
- [ ] Pull-to-refresh on the Activity tab refreshes both the feed and the
      nearby list

## Private accounts & follow requests (phase 8)

- [ ] Toggle "Private account" on in Profile → Profile settings; GET /me and
      your profile reflect it; toggle off restores public behavior
- [ ] From a second account, following a private user shows "Requested" (not
      "Following"); the private user's follower count does not change
- [ ] The private user sees the request under Profile → Profile settings →
      "Follow requests (N)"; Confirm makes the requester an accepted follower
      and the count increments; Delete removes the request with no follow
- [ ] A private account's profile hides check-ins / courts-added / streak from a
      non-follower and shows "This account is private"; an accepted follower and
      the owner see full stats
- [ ] Followers/following lists of a private account are not viewable by a
      non-follower (403 → the app shows the private notice)
- [ ] Canceling a sent request (tap "Requested" again) clears it
- [ ] Blocking a user with a pending request in either direction clears it
- [ ] A follow request fires a push to the private user; accepting fires a push
      to the requester; public follows fire no request push
- [ ] Public accounts are unchanged: following is immediate, profile shows full
      stats to everyone

## Court attributes: amenities, filters & correction (phase 9)

- [ ] Filter bar on the map and Activity list: toggling Lights / Indoor / Hoops
      / Public / Free / Covered / Water / Restroom / Parking / Fenced narrows the
      courts shown; clearing restores all; filters compose (AND)
- [ ] A court detail shows known amenities (water/restroom/parking/fenced) and
      omits unknown ones
- [ ] Signed-in "Suggest an edit" opens the editor pre-filled; changing surface,
      lights, hoop count, access, fee, or an amenity saves and is reflected on
      the court immediately; guests get a sign-in CTA
- [ ] An invalid value can't be submitted (surface limited to the enum; hoop
      count bounded)
- [ ] description/website/name are NOT editable via the editor
- [ ] A freshly-enriched OSM court near real amenities shows water/restroom/
      parking when present within ~150 m (best-effort; absence is left blank)

## Broader court coverage: seeding discovery loop (phase 10)

- [ ] Pan the map to a region with no courts you've never viewed before: a
      "Finding courts in this area…" indicator appears, and within a minute
      courts populate on their own without manually panning again
- [ ] The Activity list in a fresh area shows "Finding courts in this area…"
      then fills in as the import completes
- [ ] Zoom the map way out over an unseeded area: a "Zoom in to load courts for
      this area" hint shows (no false "no courts" claim)
- [ ] A region that is genuinely empty of courts (fully seeded, none found)
      shows the plain "no courts here yet" state, not an endless spinner
- [ ] Fast-refetch stops once courts appear (network tab: polling returns to the
      normal cadence)

## Durable background work (phase 11)

- [ ] Pan the map to a fresh region, then immediately kill/restart the API
      container: after restart (or the next cron drain) the region's courts
      still import — the pending tiles survived (were not lost with the process)
- [ ] `POST /internal/drain` without the `X-Internal-Task` secret returns 401;
      with the correct secret it returns 200 `{tiles, courts}` and advances the
      backlog
- [ ] The Cloudflare cron (every 15 min) drains retryable/failed tiles and
      90-day re-seeds with zero app traffic; the container still scales to zero
      between runs
- [ ] Court enrichment stays lazy: only courts whose detail page was viewed get
      addresses/photos/amenities (a never-viewed seeded court is not enriched)
- [ ] With INTERNAL_TASK_SECRET unset, the drain endpoint is disabled (401) and
      the in-process workers still drain on the warm path

## Player profile & court conditions (phases 14–15)

- [ ] Profile settings: set jersey number, position, height, style tags, skill
      level, and availability windows; each appears on the player card and the
      public profile, and clearing one removes it
- [ ] Height outside 120–250 cm can't be saved (the button stays disabled
      rather than round-tripping to a server error)
- [ ] Court detail → conditions: tapping a rim/net chip records a confirmation
      and the freshness line updates; the stored value follows the recent
      majority, so one wrong tap gets outvoted rather than sticking
- [ ] Signed out, condition chips are visible but not tappable

## Your-window alerts (phase 16)

Needs two accounts, a physical device with notifications granted, and an
availability window covering the current hour.

- [ ] With availability set and a favorited court, have 4+ players' worth of
      party size check in there: exactly ONE push arrives, naming the court,
      the headcount, and your window
- [ ] A further check-in at the same court does NOT produce a second push
      (crossing-only), and no second push arrives that day (20h cooldown)
- [ ] Being checked in at that court yourself suppresses the alert
- [ ] Profile settings → Court alerts → Off silences it entirely
- [ ] The court detail popular-times chart shows accent ticks under the hours
      inside your windows, with a "Your window" legend
- [ ] A court with no turnout history shows the honest "no history yet" line
      rather than an empty chart

## Open-run discovery (phase 17)

- [ ] Signed OUT, with a run planned at a nearby court: the Activity tab shows
      a "Runs near you" rail with that run; tapping it opens the court with the
      run accented
- [ ] Signed in and following the planner, the run appears once — in the feed,
      not duplicated in the rail
- [ ] Courts with a run in the next 24h carry a tick on their map pin; the tick
      reads clearly over busy map tiles at a narrow (≈390px) width
- [ ] A run more than 24h out does NOT put a tick on the pin
- [ ] Pull-to-refresh on Activity refreshes the rail with the rest

## Games & scores (phase 18)

Needs two accounts.

- [ ] Both accounts checked in at a court: record a 1v1 from account A. The
      game does NOT appear in the court's Games list yet
- [ ] Account A cannot confirm its own result; a third account that wasn't in
      the game cannot confirm it either
- [ ] Account B (the losing side) sees the pending prompt and confirms — the
      game becomes public, both names show, and the score appears if entered
- [ ] Both players' W–L on the player card updates, and XP goes up for both
- [ ] Re-confirming does not award XP twice
- [ ] Recording with yourself left off both sides is rejected
- [ ] An unconfirmed game left alone is gone after 48h (or after a manual
      drain with the row's created_at backdated)

## Looking for a run (phase 19)

- [ ] Court detail → "I'm looking to play" → pick a day and window: the bucket
      appears publicly with your name and skill chip; guests can see it
- [ ] Tapping it again withdraws you and the count drops
- [ ] Weekend days only offer weekend windows (and weekdays weekday ones)
- [ ] With 4 seekers in one bucket, every one of them gets exactly ONE push;
      a 5th joiner does not re-fire it
- [ ] Tapping that push opens the plan-a-run screen prefilled to roughly that
      day and window (correct it if the prefill is a day off near UTC midnight)
- [ ] Planning a run inside a bucket's window pushes that bucket's other
      seekers once; a second run in the same window does not re-fire

## XP, levels & streak nudges (phase 20)

- [ ] Player card shows level, tier, and a progress bar; "How you earn XP"
      lists the sources and the daily cap
- [ ] A first check-in of the day raises XP; a second check-in at the SAME
      court within 20h raises it by nothing
- [ ] Crossing a level threshold fires exactly one level-up push; tapping it
      opens the profile
- [ ] A public profile shows the other player's level chip; a private account's
      level is hidden from non-followers (not shown as "Level 1")
- [ ] Streak reminder: with a streak alive but no check-in this week, a nudge
      arrives Thu–Sat evening in the device's own time zone, at most once a
      week, and names the real streak length
- [ ] Profile settings → Streak reminders → Off silences it
- [ ] `POST /internal/drain` response includes `streak_nudges` and
      `expired_games` counts
