#!/usr/bin/env bash
# End-to-end smoke test against the local API Worker (make dev-worker on :8787).
#
# scripts/smoke.sh covers the Go API directly; this covers the layer the Worker
# adds in production and `make dev` has no equivalent for: the container proxy,
# the EMAIL binding that turns a registration into a verification email, the
# Worker-level HMAC guard on photo uploads, and the cron drain handler.
# See docs/LOCAL_WORKER.md.
set -euo pipefail

ORIGIN=${ORIGIN:-http://localhost:8787}
API="$ORIGIN/api/v1"
EMAIL="worker-smoke-$(date +%s)-$RANDOM@test.local"
PASS="password123"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Where the local EMAIL binding writes messages instead of sending them.
EMAIL_DIR="$repo_root/deploy/api/.wrangler/tmp/email"
# Same committed dev placeholder scripts/smoke.sh uses; deploy/api/.dev.vars
# gives the Worker the matching value. Read, never inlined.
INTERNAL_TASK_SECRET=${INTERNAL_TASK_SECRET:-$(
  sed -n 's/^DEV_INTERNAL_SECRET := //p' "$repo_root/Makefile"
)}
if [ -z "$INTERNAL_TASK_SECRET" ]; then
  echo "could not determine INTERNAL_TASK_SECRET (set it, or restore DEV_INTERNAL_SECRET in the Makefile)" >&2
  exit 2
fi

jqget() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }
count_emails() { ls "$EMAIL_DIR"/*/email-text/*.txt 2>/dev/null | wc -l | tr -d ' '; }

throttled() {
  echo "FAIL: rate limited (HTTP 429) on $1."
  echo "      The auth limiter allows RATE_LIMIT_AUTH_PER_MIN/min per IP (default 10)."
  echo "      Wait a minute, or raise the limit for the dev server."
  exit 1
}

echo "== worker and container are up =="
curl -sf "$ORIGIN/healthz" >/dev/null || {
  echo "FAIL: no healthy worker on $ORIGIN — start one with 'make dev-worker'"; exit 1; }
echo "ok: /healthz 200 (worker proxied into the container)"

echo "== register through the worker =="
BEFORE=$(count_emails)
HDRS=$(mktemp)
trap 'rm -f "$HDRS"' EXIT
# Deliberately sent WITH the real internal secret: the origin only emits the
# verification-token headers to a caller holding it, and the Worker must strip
# them from the response anyway. That is the assertion two steps down.
STATUS=$(curl -s -D "$HDRS" -o /dev/null -w '%{http_code}' -X POST "$API/auth/register" \
  -H "X-Internal-Task: $INTERNAL_TASK_SECRET" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"display_name\":\"Worker Smoke\"}")
[ "$STATUS" = "429" ] && throttled register
[ "$STATUS" = "202" ] || { echo "FAIL: expected 202 from register, got $STATUS"; exit 1; }
echo "ok: registered $EMAIL (202, verification pending)"

echo "== worker never returns the verification token =="
# sanitizedEmailResponse() in deploy/api/src/index.ts drops these on every path,
# so even an authenticated internal caller cannot read the token off the wire.
for header in Token Expires To; do
  if grep -qi "^X-Pull-Up-Email-Verification-$header:" "$HDRS"; then
    echo "FAIL: worker leaked X-Pull-Up-Email-Verification-$header"; exit 1
  fi
done
echo "ok: no verification headers survive the worker, even with a valid secret"

echo "== worker sent the email through its EMAIL binding =="
for _ in $(seq 1 20); do
  AFTER=$(count_emails)
  [ "$AFTER" -gt "$BEFORE" ] && break
  sleep 1
done
[ "${AFTER:-0}" -gt "$BEFORE" ] || {
  echo "FAIL: no message appeared under $EMAIL_DIR"; exit 1; }
NEWEST=$(ls -t "$EMAIL_DIR"/*/email-text/*.txt | head -1)
echo "ok: captured $(basename "$NEWEST")"

echo "== verify email using the token from that message =="
VERIFY_TOKEN=$(sed -n 's/.*#token=\([0-9a-f]\{16,\}\).*/\1/p' "$NEWEST" | head -1)
[ -n "$VERIFY_TOKEN" ] || { echo "FAIL: no token in the captured email"; exit 1; }
BODY=$(mktemp)
trap 'rm -f "$HDRS" "$BODY"' EXIT
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$API/auth/email-verification/verify" \
  -d "{\"token\":\"$VERIFY_TOKEN\"}")
[ "$STATUS" = "429" ] && throttled "email verification"
[ "$STATUS" = "200" ] || { echo "FAIL: expected 200 from verify, got $STATUS: $(cat "$BODY")"; exit 1; }
TOKEN=$(jqget "['access_token']" < "$BODY")
echo "ok: verified through the full email round trip"

# Fresh coordinates per run, so repeated runs do not trip the court
# nearby-duplicate check. ~1000 km away is outside the 150 m check-in radius.
read -r LAT LNG FAR_LAT FAR_LNG < <(python3 -c "
import random
lat, lng = random.uniform(-50, 50), random.uniform(-150, 150)
print(lat, lng, lat + 9, lng + 9)")

echo "== create a court through the worker =="
COURT_ID=$(curl -sf -X POST "$API/courts" -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\":\"Worker Smoke Court\",\"lat\":$LAT,\"lng\":$LNG,\"hoop_count\":2,\"indoor\":false}" \
  | jqget "['id']")
echo "ok: court $COURT_ID at $LAT,$LNG"

echo "== geo-verified check-in through the worker =="
FAR_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/courts/$COURT_ID/check-ins" \
  -H "Authorization: Bearer $TOKEN" -d "{\"lat\":$FAR_LAT,\"lng\":$FAR_LNG}")
[ "$FAR_STATUS" = "422" ] && echo "ok: 422 when far away" || { echo "FAIL: expected 422, got $FAR_STATUS"; exit 1; }
curl -sf -X POST "$API/courts/$COURT_ID/check-ins" -H "Authorization: Bearer $TOKEN" \
  -d "{\"lat\":$LAT,\"lng\":$LNG}" >/dev/null
echo "ok: checked in"

echo "== activity reflects the check-in =="
COUNT=$(curl -sf "$API/courts/$COURT_ID/activity" | jqget "['active_count']")
[ "$COUNT" = "1" ] && echo "ok: active_count=1" || { echo "FAIL: active_count=$COUNT"; exit 1; }

echo "== worker rejects an unsigned photo upload =="
# The same assertion .github/workflows/deploy.yml makes against production.
UPLOAD_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  "$ORIGIN/photos/upload/courts/123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174001.jpg")
[ "$UPLOAD_STATUS" = "403" ] && echo "ok: 403 without an HMAC signature" || {
  echo "FAIL: expected 403 on unsigned upload, got $UPLOAD_STATUS"; exit 1; }

echo "== cron drain handler runs =="
# Scheduled events do not fire on their own in local dev; trigger one.
curl -sf "$ORIGIN/cdn-cgi/handler/scheduled" >/dev/null || {
  echo "FAIL: scheduled handler errored"; exit 1; }
echo "ok: scheduled drain returned"

echo
echo "ALL WORKER SMOKE TESTS PASSED ✅"
