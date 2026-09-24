#!/bin/bash
API="http://localhost:3000"
Q() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)"; }
PLANS=$(bunx tsx .zscripts/tmp/plans.ts 2>/dev/null | head -1)
TSP_S=$(echo "$PLANS" | Q "['trade-signals-pro/Starter']")
SBP_F=$(echo "$PLANS" | Q "['saas-growth-blueprint/Founder']")
DV_P=$(echo "$PLANS" | Q "['design-vault/Personal']")
DV_S=$(echo "$PLANS" | Q "['design-vault/Studio']")
FC_S=$(echo "$PLANS" | Q "['fitcore-coaching/Solo']")
AISHA=$(bunx tsx -e 'import {PrismaClient} from "@prisma/client"; const db=new PrismaClient(); db.user.findUnique({where:{email:"aisha@whoply.io"}}).then(u=>{console.log(u!.id); return db.$disconnect()});' 2>/dev/null)
login() { curl -s -X POST $API/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"$1\"}" | Q "['id']"; }
checkout() { curl -s -X POST $API/api/checkout -H "Content-Type: application/json" -H "x-user-id: $1" -d "$2"; }
advance() { curl -s -X POST $API/api/billing/advance -H "Content-Type: application/json" -H "x-user-id: $1" -d "{\"days\":$2}"; }

echo "════ A1b: DUNNING EXHAUSTION + LICENSE REVOKE (SBP Founder, LICENSE,FILE) ════"
U1=$(login qa-dun2@demo.io)
R=$(checkout "$U1" "{\"planId\":\"$SBP_F\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB1=$(echo "$R" | Q "['subscriptionId']")
echo "checkout: $(echo "$R" | Q "['status']") sub=$SUB1 license=$(echo "$R" | Q "['licenseKeyId']" | head -c 12)"
bunx tsx .zscripts/tmp/dbq.ts flip-card "$SUB1" 0002 2>/dev/null
advance "$U1" 32 | Q "['events']" | python3 -c "import sys;print('+32d events:',[e for e in eval(sys.stdin.read()) if 'SaaS' in e or 'attempt' in e.lower()])"
curl -s -X POST $API/api/billing/tick -H "x-worker-secret: vendly-worker-7f3a9c" | Q "['renewalsFailed']" | xargs echo "immediate tick renewalsFailed (want 0):"
advance "$U1" 1 > /dev/null
advance "$U1" 1 | Q "['canceled']" | xargs echo "+1d+1d canceled (want 1):"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB1" 2>/dev/null

echo ""
echo "════ A2: PAST_DUE → RECOVERY + change_plan BLOCK (DV Personal) ════"
U2=$(login qa-recover@demo.io)
R=$(checkout "$U2" "{\"planId\":\"$DV_P\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB2=$(echo "$R" | Q "['subscriptionId']")
echo "checkout: $(echo "$R" | Q "['status']") sub=$SUB2"
bunx tsx .zscripts/tmp/dbq.ts flip-card "$SUB2" 0002 2>/dev/null
advance "$U2" 32 | python3 -c "import sys,json;d=json.load(sys.stdin);print('+32d: my sub →', [e for e in d['events'] if 'Design Vault (Personal)' in e])"
echo "--- change_plan while PAST_DUE (want 409) ---"
curl -s -o /dev/null -w "change_plan HTTP=%{http_code}\n" -X PATCH $API/api/subscriptions/$SUB2 -H "Content-Type: application/json" -H "x-user-id: $U2" -d "{\"action\":\"change_plan\",\"planId\":\"$DV_S\"}"
curl -s -X PATCH $API/api/subscriptions/$SUB2 -H "Content-Type: application/json" -H "x-user-id: $U2" -d "{\"action\":\"change_plan\",\"planId\":\"$DV_S\"}" | Q "['error']" | xargs echo "  error:"
echo "--- duplicate checkout while PAST_DUE (want 409) ---"
curl -s -o /dev/null -w "dup checkout HTTP=%{http_code}\n" -X POST $API/api/checkout -H "Content-Type: application/json" -H "x-user-id: $U2" -d "{\"planId\":\"$DV_P\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}"
echo "--- fix card → +1d retry succeeds ---"
bunx tsx .zscripts/tmp/dbq.ts flip-card "$SUB2" 4242 2>/dev/null
advance "$U2" 1 | python3 -c "import sys,json;d=json.load(sys.stdin);print('+1d: my sub →',[e for e in d['events'] if 'Design Vault (Personal)' in e])"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB2" 2>/dev/null | head -4

echo ""
echo "════ A3: $0 COMP RENEWAL (100% promo, DV Personal) ════"
PROMO=$(curl -s -X POST $API/api/promos -H "Content-Type: application/json" -H "x-user-id: $AISHA" -d '{"kind":"PERCENT","value":100,"durationMonths":3,"code":"QA-COMPFREE"}' | Q "['code']")
echo "promo created: $PROMO"
U3=$(login qa-comp@demo.io)
R=$(checkout "$U3" "{\"planId\":\"$DV_P\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"},\"promoCode\":\"QA-COMPFREE\"}")
SUB3=$(echo "$R" | Q "['subscriptionId']")
echo "checkout: $(echo "$R" | Q "['status']") discount=$(echo "$R" | Q "['discountCents']") sub=$SUB3"
advance "$U3" 32 | python3 -c "import sys,json;d=json.load(sys.stdin);print('+32d: my sub →',[e for e in d['events'] if 'Design Vault (Personal)' in e])"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB3" 2>/dev/null | grep -E "SUB_STATUS|INVOICES|INVOICE_NUMBERS"

echo ""
echo "════ A4: change_plan REAL proration charge + double cancel_now guard (DV) ════"
U4=$(login qa-guard@demo.io)
R=$(checkout "$U4" "{\"planId\":\"$DV_P\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB4=$(echo "$R" | Q "['subscriptionId']")
echo "checkout: $(echo "$R" | Q "['status']") sub=$SUB4"
curl -s -X PATCH $API/api/subscriptions/$SUB4 -H "Content-Type: application/json" -H "x-user-id: $U4" -d "{\"action\":\"change_plan\",\"planId\":\"$DV_S\"}" | Q "['message']" | xargs echo "change_plan:"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB4" 2>/dev/null | grep -E "SUB_STATUS|INVOICE_NUMBERS"
curl -s -X PATCH $API/api/subscriptions/$SUB4 -H "Content-Type: application/json" -H "x-user-id: $U4" -d '{"action":"cancel_now"}' | Q "['message']" | xargs echo "cancel_now #1:"
curl -s -o /dev/null -w "cancel_now #2 HTTP=%{http_code} (want 409)\n" -X PATCH $API/api/subscriptions/$SUB4 -H "Content-Type: application/json" -H "x-user-id: $U4" -d '{"action":"cancel_now"}'

echo ""
echo "════ A5: PARALLEL CHECKOUT RACE (want exactly one 201, one 409) ════"
U5=$(login qa-race@demo.io)
(curl -s -o /tmp/r1.json -w "%{http_code}" -X POST $API/api/checkout -H "Content-Type: application/json" -H "x-user-id: $U5" -d "{\"planId\":\"$FC_S\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}" > /tmp/r1.code) &
(curl -s -o /tmp/r2.json -w "%{http_code}" -X POST $API/api/checkout -H "Content-Type: application/json" -H "x-user-id: $U5" -d "{\"planId\":\"$FC_S\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}" > /tmp/r2.code) &
wait
echo "race results: r1=$(cat /tmp/r1.code) r2=$(cat /tmp/r2.code)"
echo "  r1: $(cat /tmp/r1.json | head -c 100)"
echo "  r2: $(cat /tmp/r2.json | head -c 100)"
SUBS5=$(bunx tsx -e "import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); db.subscription.count({where:{userId:'$U5',productId:(await db.plan.findUnique({where:{id:'$FC_S'}}))!.productId}}).then(c=>{console.log('live subs for user:',c); return db.\$disconnect()});" 2>/dev/null)
echo "  $SUBS5 (want 1)"

echo ""
echo "════ A6: MONTH-END CLAMP (renewal ON Oct 31 → Nov 30, not Dec 1) ════"
U6=$(login qa-clamp@demo.io)
R=$(checkout "$U6" "{\"planId\":\"$FC_S\",\"gateway\":\"STRIPE\",\"card\":{\"number\":\"4242424242424242\",\"expMonth\":12,\"expYear\":2030,\"cvc\":\"123\"}}")
SUB6=$(echo "$R" | Q "['subscriptionId']")
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
bunx tsx .zscripts/tmp/dbq.ts set-period-end "$SUB6" "2026-10-30T12:00:00.000Z" "2026-09-30T12:00:00.000Z" 2>/dev/null
DAYS_TO_OCT31=$(( ( $(date -u -d "2026-10-31" +%s) - $(date -u +%s) ) / 86400 + 1 ))
advance "$U6" $DAYS_TO_OCT31 | Q "['newNow']" | xargs echo "clock now:"
bunx tsx .zscripts/tmp/dbq.ts sub "$SUB6" 2>/dev/null | grep -E "PERIOD|SUB_STATUS"

echo ""
echo "════ A7: INVOICE NUMBER INTEGRITY ════"
bunx tsx .zscripts/tmp/dbq.ts invoice-dupes 2>/dev/null
