#!/bin/bash
API="http://localhost:3000"
TSP_STARTER="cmudnb89s000bk9dz5s1lzmgg"
echo "=== A1: DUNNING EXHAUSTION (fresh seed) ==="
U=$(curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" -d '{"email":"qa-dunning@demo.io"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
R=$(curl -s -X POST $API/api/checkout -H "Content-Type: application/json" -H "x-user-id: $U" -d "{\"planId\":\"$TSP_STARTER\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242 4242 4242 4242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin).get('subscriptionId',''))")
echo "USER: $U | SUB: $SUB | checkout: $(echo $R | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('status'))")"
bunx tsx .zscripts/tmp/dbq.ts flip-card "$SUB" 0002 2>/dev/null

echo "--- ADVANCE +32d: seeded subs renew too; my sub fails (attempt 1) ---"
curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $U" -d '{"days":32}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('events:',[e for e in d['events'] if 'Trade Signals Pro (Starter)' in e or 'attempt' in e.lower()])"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB" 2>/dev/null | head -4

echo "--- IMMEDIATE TICK (cadence: must NOT retry) ---"
curl -s -X POST $API/api/billing/tick -H "x-worker-secret: vendly-worker-7f3a9c" | python3 -c "import sys,json;d=json.load(sys.stdin);print('renewalsFailed:',d['renewalsFailed'],'events:',d['events'])"

echo "--- ADVANCE +1d (attempt 2) ---"
curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $U" -d '{"days":1}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('events:',[e for e in d['events'] if 'attempt' in e.lower()])"

echo "--- ADVANCE +1d (attempt 3 → CANCELED) ---"
curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $U" -d '{"days":1}' | python3 -c "import sys,json;d=json.load(sys.stdin);print('canceled:',d['canceled'],'| events:',[e for e in d['events'] if 'attempt' in e.lower() or 'Dunning' in e])"

echo "--- FINAL STATE ---"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB" 2>/dev/null
