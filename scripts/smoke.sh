#!/usr/bin/env bash
# End-to-end smoke test against a running API (make dev in another terminal).
# Exercises: register → verify email → add court (dupe check) → check-in
# near/far → crowd report → activity.
#
# For the same flow through the deployed Worker shape, see scripts/smoke-worker.sh.
set -euo pipefail

API=${API:-http://localhost:8080/api/v1}
# $RANDOM as well as the timestamp: a whole run takes well under a second
# against a local API, so back-to-back runs would otherwise reuse an address
# and get a 409 from register.
EMAIL="smoke-$(date +%s)-$RANDOM@test.local"
PASS="password123"

# Registration only returns tokens once the address is verified, and the
# verification token is a response header the origin emits only to a caller
# holding INTERNAL_TASK_SECRET (normally the API Worker, which turns it into an
# email). Locally that is the Makefile's committed dev placeholder — read from
# there rather than inlined here, so this script carries no secret of its own.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INTERNAL_TASK_SECRET=${INTERNAL_TASK_SECRET:-$(
  sed -n 's/^DEV_INTERNAL_SECRET := //p' "$repo_root/Makefile"
)}
if [ -z "$INTERNAL_TASK_SECRET" ]; then
  echo "could not determine INTERNAL_TASK_SECRET (set it, or restore DEV_INTERNAL_SECRET in the Makefile)" >&2
  exit 2
fi

jqget() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

# The auth limiter allows RATE_LIMIT_AUTH_PER_MIN requests/minute per IP
# (default 10) and a run spends two of them, so a handful of back-to-back runs
# will legitimately be throttled. Say so plainly instead of failing obscurely.
throttled() {
  echo "FAIL: rate limited (HTTP 429) on $1."
  echo "      The auth limiter allows RATE_LIMIT_AUTH_PER_MIN/min per IP (default 10)"
  echo "      and each run uses two. Wait a minute, or raise the limit for the dev server."
  exit 1
}

echo "== register =="
HDRS=$(mktemp)
trap 'rm -f "$HDRS"' EXIT
STATUS=$(curl -s -D "$HDRS" -o /dev/null -w '%{http_code}' -X POST "$API/auth/register" \
  -H "X-Internal-Task: $INTERNAL_TASK_SECRET" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"display_name\":\"Smoke Tester\"}")
[ "$STATUS" = "429" ] && throttled register
[ "$STATUS" = "202" ] || { echo "FAIL: expected 202 from register, got $STATUS"; exit 1; }
VERIFY_TOKEN=$(grep -i '^X-Pull-Up-Email-Verification-Token:' "$HDRS" | tr -d '\r' | cut -d' ' -f2)
[ -n "$VERIFY_TOKEN" ] || { echo "FAIL: no verification token header (is INTERNAL_TASK_SECRET the server's?)"; exit 1; }
echo "ok: registered $EMAIL (202, verification pending)"

echo "== verify email =="
BODY=$(mktemp)
trap 'rm -f "$HDRS" "$BODY"' EXIT
STATUS=$(curl -s -o "$BODY" -w '%{http_code}' -X POST "$API/auth/email-verification/verify" \
  -d "{\"token\":\"$VERIFY_TOKEN\"}")
[ "$STATUS" = "429" ] && throttled "email verification"
[ "$STATUS" = "200" ] || { echo "FAIL: expected 200 from verify, got $STATUS: $(cat "$BODY")"; exit 1; }
TOKEN=$(jqget "['access_token']" < "$BODY")
echo "ok: verified, signed in"

# Fresh coordinates per run. Fixed ones would make this script pass exactly
# once per database: the court it creates then trips its own nearby-duplicate
# check on the next run.
read -r LAT LNG DUPE_LAT DUPE_LNG FAR_LAT FAR_LNG < <(python3 -c "
import random
lat, lng = random.uniform(-50, 50), random.uniform(-150, 150)
# ~5 m away: inside the duplicate radius, so the create below must be rejected.
# ~1000 km away: outside the 150 m check-in radius.
print(lat, lng, lat + 0.000044, lng - 0.000008, lat + 9, lng + 9)")

echo "== create court =="
COURT=$(curl -sf -X POST "$API/courts" -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\":\"Smoke Test Court\",\"lat\":$LAT,\"lng\":$LNG,\"hoop_count\":2,\"indoor\":false}")
COURT_ID=$(echo "$COURT" | jqget "['id']")
echo "ok: court $COURT_ID at $LAT,$LNG"

echo "== duplicate detection =="
DUPE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/courts" -H "Authorization: Bearer $TOKEN" \
  -d "{\"name\":\"Dupe Court\",\"lat\":$DUPE_LAT,\"lng\":$DUPE_LNG}")
[ "$DUPE_STATUS" = "409" ] && echo "ok: 409 on nearby duplicate" || { echo "FAIL: expected 409, got $DUPE_STATUS"; exit 1; }

echo "== check-in from far away is rejected =="
FAR_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/courts/$COURT_ID/check-ins" -H "Authorization: Bearer $TOKEN" \
  -d "{\"lat\":$FAR_LAT,\"lng\":$FAR_LNG}")
[ "$FAR_STATUS" = "422" ] && echo "ok: 422 when far away" || { echo "FAIL: expected 422, got $FAR_STATUS"; exit 1; }

echo "== check-in at the court =="
curl -sf -X POST "$API/courts/$COURT_ID/check-ins" -H "Authorization: Bearer $TOKEN" \
  -d "{\"lat\":$LAT,\"lng\":$LNG}" >/dev/null
echo "ok: checked in"

echo "== crowd report =="
curl -sf -X POST "$API/courts/$COURT_ID/reports" -H "Authorization: Bearer $TOKEN" \
  -d '{"player_count":8,"run_quality":"good_run","note":"smoke test run"}' >/dev/null
echo "ok: reported"

echo "== activity reflects both =="
ACTIVITY=$(curl -sf "$API/courts/$COURT_ID/activity")
COUNT=$(echo "$ACTIVITY" | jqget "['active_count']")
[ "$COUNT" = "1" ] && echo "ok: active_count=1" || { echo "FAIL: active_count=$COUNT"; exit 1; }

echo "== court auto-verified by geo-verified check-in =="
STATUS=$(curl -sf "$API/courts/$COURT_ID" | jqget "['status']")
[ "$STATUS" = "verified" ] && echo "ok: status=verified" || { echo "FAIL: status=$STATUS"; exit 1; }

echo
echo "ALL SMOKE TESTS PASSED ✅"
