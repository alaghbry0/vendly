#!/bin/bash
API="http://localhost:3000"
Q() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
PLANS=$(bunx tsx .zscripts/tmp/plans.ts 2>/dev/null | head -1)
SBP_F=$(echo "$PLANS" | Q "['saas-growth-blueprint/Founder']")
DV_P=$(echo "$PLANS" | Q "['design-vault/Personal']")
DV_S=$(echo "$PLANS" | Q "['design-vault/Studio']")
FC_S=$(echo "$PLANS" | Q "['fitcore-coaching/Solo']")
login() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"$1\"}" | Q "['id']"; }
checkout() { curl -s -X POST $API/api/checkout -H "Content-Type: application/json" -H "x-user-id: $1" -d "$2"; }
advance() { curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $1" -d "{\"days\":$2}"; }

echo "════ A1b-FIX: DUNNING EXHAUSTION + LICENSE REVOKE (SBP Founder) ════"
U1=$(login qa-dun3@demo.io)
R=$(checkout "$U1" "{\"planId\":\"$SBP_F\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB1=$(echo "$R" | Q "['subscriptionId']")
echo "checkout: $(echo "$R" | Q "['status']") license=$(echo "$R" | Q "['licenseKeyId']" | head -c 10)"
bunx tsx .zscripts/tmp/dbq.ts flip-card "$SUB1" 0002 2>/dev/null
advance "$U1" 32 | python3 -c "import sys,json;d=json.load(sys.stdin);print('  +32d:',[e for e in d['events'] if 'SaaS' in e])"
curl -s -X POST $API/api/billing/tick -H "x-worker-secret: vendly-worker-7f3a9c" | Q "['renewalsFailed']" | xargs echo "  immediate tick failed (want 0):"
advance "$U1" 1 | python3 -c "import sys,json;d=json.load(sys.stdin);print('  +1d:',[e for e in d['events'] if 'SaaS' in e])"
advance "$U1" 1 | python3 -c "import sys,json;d=json.load(sys.stdin);print('  +1d:',[e for e in d['events'] if 'SaaS' in e])"
echo "  --- final ---"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB1" 2>/dev/null

echo ""
echo "════ A2-FIX: PAST_DUE → change_plan 409 → card fix → RECOVERY ════"
U2=$(login qa-rec2@demo.io)
R=$(checkout "$U2" "{\"planId\":\"$DV_P\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB2=$(echo "$R" | Q "['subscriptionId']")
echo "checkout: $(echo "$R" | Q "['status']")"
bunx tsx .zscripts/tmp/dbq.ts flip-card "$SUB2" 0002 2>/dev/null
advance "$U2" 32 | python3 -c "import sys,json;d=json.load(sys.stdin);print('  +32d:',[e for e in d['events'] if 'Design Vault (Personal)' in e])"
curl -s -X PATCH $API/api/subscriptions/$SUB2 -H "Content-Type: application/json" -H "x-user-id: $U2" -d "{\"action\":\"change_plan\",\"planId\":\"$DV_S\"}" > /tmp/cp.json
echo "  change_plan while PAST_DUE → $(python3 -c "import json;d=json.load(open('/tmp/cp.json'));print(d.get('error') or d.get('message'))")"
bunx tsx .zscripts/tmp/dbq.ts flip-card "$SUB2" 4242 2>/dev/null
advance "$U2" 1 | python3 -c "import sys,json;d=json.load(sys.stdin);print('  +1d after fix:',[e for e in d['events'] if 'Design Vault (Personal)' in e])"
echo "  --- final ---"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB2" 2>/dev/null | head -5

echo ""
echo "════ A6-FIX: MONTH-END CLAMP (renewal ON May 31 → June 30, not July 1) ════"
U6=$(login qa-clamp2@demo.io)
R=$(checkout "$U6" "{\"planId\":\"$FC_S\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB6=$(echo "$R" | Q "['subscriptionId']")
NOW=$(advance "$U6" 0 2>/dev/null | Q "['newNow']" || true)
echo "  current sim clock: $NOW"
# next month-end day: compute days to next "31st" from the sim clock
 bunx tsx .zscripts/tmp/dbq.ts set-period-end "$SUB6" "2027-05-30T12:00:00.000Z" "2027-04-30T12:00:00.000Z" 2>/dev/null
DAYS=$(python3 -c "
from datetime import datetime, timezone
now = datetime.fromisoformat('$NOW'.replace('Z','+00:00'))
target = datetime(2027,5,31,tzinfo=timezone.utc)
d = (target - now).days + 1
print(max(1,min(90,d)))")
echo "  advancing +$DAYS d to May 31 2027…"
advance "$U6" $DAYS | Q "['newNow']" | xargs echo "  clock now:"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB6" 2>/dev/null | grep -E "PERIOD|SUB_STATUS"
echo "  EXPECT: PERIOD end 2027-06-30 (clamped) — NOT 2027-07-01"
