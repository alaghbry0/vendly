#!/bin/bash
API="http://localhost:3000"
Q() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
PLANS=$(bunx tsx .zscripts/tmp/plans.ts 2>/dev/null | head -1)
TSP_S=$(echo "$PLANS" | Q "['trade-signals-pro/Starter']")
login() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"$1\"}" | Q "['id']"; }

echo "════ A8: ENGINE RACE (advance ∥ tick → one skips, no double renewals) ════"
U=$(login qa-race-engine@demo.io)
# fire both simultaneously
(curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $U" -d '{"days":33}' > /tmp/adv.json) &
(curl -s -X POST $API/api/billing/tick -H "x-worker-secret: vendly-worker-7f3a9c" > /tmp/tick.json) &
wait
echo "  advance: renewals=$(python3 -c "import json;print(json.load(open('/tmp/adv.json'))['renewals'])") events0=$(python3 -c "import json;d=json.load(open('/tmp/adv.json'));print(d['events'][:1])")"
echo "  tick: ok=$(python3 -c "import json;print(json.load(open('/tmp/tick.json'))['ok'])") skipped=$(python3 -c "import json;print(json.load(open('/tmp/tick.json'))['skipped'])") renewals=$(python3 -c "import json;print(json.load(open('/tmp/tick.json'))['renewals'])")"

echo ""
echo "════ A9: NO PM ON FILE → renewal must FAIL honestly (no fake success) ════"
U2=$(login qa-nopm@demo.io)
R=$(curl -s -X POST $API/api/checkout -H "Content-Type: application/json" -H "x-user-id: $U2" -d "{\"planId\":\"$TSP_S\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"},\"saveMethod\":false}")
SUB=$(echo "$R" | Q "['subscriptionId']")
echo "  checkout (saveMethod:false): $(echo "$R" | Q "['status']") sub=$SUB"
curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $U2" -d '{"days":32}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('  +32d:',[e for e in d['events'] if 'Starter' in e])"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB" 2>/dev/null | grep -E "SUB_STATUS|FAILED_AT"
echo "  EXPECT: PAST_DUE + 1 FAILED invoice with buyer-actionable message"
