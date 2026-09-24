#!/bin/bash
API="http://localhost:3000"
Q() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
PLANS=$(bunx tsx .zscripts/tmp/plans.ts 2>/dev/null | head -1)
FC_S=$(echo "$PLANS" | Q "['fitcore-coaching/Solo']")
login() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"$1\"}" | Q "['id']"; }

U=$(login qa-clamp3@demo.io)
R=$(curl -s -X POST $API/api/checkout -H "Content-Type: application/json" -H "x-user-id: $U" -d "{\"planId\":\"$FC_S\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB=$(echo "$R" | Q "['subscriptionId']")
echo "checkout: $(echo "$R" | Q "['status']") sub=$SUB"
# Set periodEnd = Aug 30 2027 (due) — clock ~Jul 21 2027, so the worker can't touch it yet
bunx tsx .zscripts/tmp/dbq.ts set-period-end "$SUB" "2027-08-30T12:00:00.000Z" "2027-07-30T12:00:00.000Z" 2>/dev/null
# Advance to Aug 31 2027 (the renewal runs ON Aug 31 → +1 month must clamp to Sep 30, not Oct 1)
NOW=$(curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $U" -d '{"days":1}' | Q "['newNow']")
echo "clock: $NOW"
DAYS=$(python3 -c "
from datetime import datetime, timezone
now = datetime.fromisoformat('$NOW'.replace('Z','+00:00'))
target = datetime(2027,8,31,12,0,5,tzinfo=timezone.utc)
print(max(1,min(90,(target-now).days)))")
echo "advancing +$DAYS d → Aug 31…"
curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $U" -d "{\"days\":$DAYS}" | Q "['newNow']" | xargs echo "clock now:"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB" 2>/dev/null | grep -E "PERIOD|SUB_STATUS"
echo "EXPECT: periodEnd 2027-09-30 (clamped). BUGGY would be 2027-10-01."
