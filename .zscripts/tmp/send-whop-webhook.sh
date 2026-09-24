#!/bin/bash
# send-whop-webhook.sh <type> <paymentId> [amountDollars] [eventId]
TYPE="$1"; PAYID="$2"; AMT="${3:-12.00}"; EVID="${4:-evt_test_$(date +%s)}"
SECRET=$(grep '^WHOP_WEBHOOK_SECRET=' /home/z/my-project/.env | cut -d= -f2 | tr -d ' \r')
TS=$(date +%s)
BODY="{\"id\":\"${EVID}\",\"type\":\"${TYPE}\",\"data\":{\"id\":\"${PAYID}\",\"status\":\"paid\",\"amount\":{\"amount\":\"${AMT}\",\"currency\":\"usd\"}}}"
# svix: signed = webhook_id.webhook_timestamp.rawBody
SIG=$(EVID="$EVID" TS="$TS" BODY="$BODY" SECRET="$SECRET" python3 -c "
import hmac, base64, os
signed = f'{os.environ[\"EVID\"]}.{os.environ[\"TS\"]}.{os.environ[\"BODY\"]}'
print('v1,' + base64.b64encode(hmac.new(os.environ['SECRET'].encode(), signed.encode(), 'sha256').digest()).decode())
")
curl -s -X POST http://localhost:3000/api/webhooks/whop \
  -H "content-type: application/json" \
  -H "webhook-id: ${EVID}" \
  -H "webhook-timestamp: ${TS}" \
  -H "webhook-signature: ${SIG}" \
  -d "${BODY}"
echo
