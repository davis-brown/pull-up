#!/usr/bin/env bash
# End-to-end smoke test against a running API (make dev in another terminal).
# Exercises: register → login → add court (dupe check) → check-in near/far →
# crowd report → activity.
set -euo pipefail

API=${API:-http://localhost:8080/api/v1}
EMAIL="smoke-$(date +%s)@test.local"
PASS="password123"

jqget() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

echo "== register =="
REG=$(curl -sf -X POST "$API/auth/register" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"display_name\":\"Smoke Tester\"}")
TOKEN=$(echo "$REG" | jqget "['access_token']")
echo "ok: registered $EMAIL"

echo "== create court (Rucker Park) =="
COURT=$(curl -sf -X POST "$API/courts" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Smoke Test Court","lat":40.829256,"lng":-73.936192,"hoop_count":2,"indoor":false}')
COURT_ID=$(echo "$COURT" | jqget "['id']")
echo "ok: court $COURT_ID"

echo "== duplicate detection =="
DUPE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/courts" -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Dupe Court","lat":40.829300,"lng":-73.936200}')
[ "$DUPE_STATUS" = "409" ] && echo "ok: 409 on nearby duplicate" || { echo "FAIL: expected 409, got $DUPE_STATUS"; exit 1; }

echo "== check-in from far away is rejected =="
FAR_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/courts/$COURT_ID/check-ins" -H "Authorization: Bearer $TOKEN" \
  -d '{"lat":40.7,"lng":-74.0}')
[ "$FAR_STATUS" = "422" ] && echo "ok: 422 when far away" || { echo "FAIL: expected 422, got $FAR_STATUS"; exit 1; }

echo "== check-in at the court =="
curl -sf -X POST "$API/courts/$COURT_ID/check-ins" -H "Authorization: Bearer $TOKEN" \
  -d '{"lat":40.829256,"lng":-73.936192}' >/dev/null
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
