# Deep links (universal / app links)

Share links (`https://<domain>/court/<id>` and `?run=<sessionId>`) open the
app when installed and the web app otherwise. This requires the domain to
host two association files (served by the web Worker, `app/worker.ts`) and
the app to declare the domain (`app/app.config.ts`).

## Configuration

- **App:** set `EXPO_PUBLIC_WEB_URL=https://<domain>` at build time
  (`app.config.ts` derives `webHost` from it for both platforms).
- **Worker vars** (`app/wrangler.jsonc`):
  - `IOS_APP_ID` = `<TEAM_ID>.com.pullup.app`
  - `ANDROID_CERT_SHA256` = release signing cert SHA-256 fingerprint
  - `API_URL`, `APPLE_APP_STORE_ID`, `IOS_STORE_URL`, `ANDROID_STORE_URL`

## Where the values come from

- **Apple Team ID:** Apple Developer account → Membership. `IOS_APP_ID` is
  `<TEAM_ID>.com.pullup.app`.
- **Android cert SHA-256:** `eas credentials` (Android → production keystore)
  prints the SHA-256 fingerprint; or
  `keytool -list -v -keystore <ks>`. Use the **release** cert that signs the
  Play build (Play App Signing may re-sign — use the fingerprint Play shows
  under Setup → App integrity).
- **Apple App Store ID:** numeric ID from App Store Connect once the app
  record exists (also used for the Smart App Banner).

## Validating

- **iOS:** `https://<domain>/.well-known/apple-app-site-association` must
  return `application/json` (no `.json` extension). Check with Apple's CDN:
  `https://app-site-association.cdn-apple.com/a/v1/<domain>`.
- **Android:** `https://<domain>/.well-known/assetlinks.json` — validate with
  Google's Statement List Tester (search "Digital Asset Links tester") or
  `https://developers.google.com/digital-asset-links/tools/generator`.
- On device: tap a `https://<domain>/court/<id>` link; the app opens directly
  once the OS has verified the association (Android verifies on install; iOS
  fetches the AASA on install/update).
