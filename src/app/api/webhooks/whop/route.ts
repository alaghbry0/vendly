import { db } from "@/lib/db";
import { getNow } from "@/lib/clock";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { reconcileWhopEvent } from "@/lib/whop-reconcile";
import { createHmac } from "crypto";

// ============ Whop webhook ingestion (real-time reconciliation) ============
//
// POST /api/webhooks/whop — receives Whop webhook events (payments, refunds,
// membership changes) and reconciles them against local invoices.
//
// Security:
//   • HMAC-SHA256 signature verification over the RAW body, svix-style:
//       signedContent = `${webhook_id}.${webhook_timestamp}.${rawBody}`
//       header `webhook-signature` = "v1," + base64(hmac(secret, signedContent))
//     (Whop delivers via svix; the simple x-whop-signature hex scheme is
//     accepted as a fallback for manual tunnel testing.)
//   • Constant-time comparison — no timing oracles.
//   • Replay protection: timestamps older than 5 minutes are rejected.
//   • Event-id dedupe: WhopEvent table (unique eventId) — redeliveries are
//     acknowledged with 200 but never processed twice.
//
// Observability: every ACCEPTED event gets a WhopEvent row whose `outcome`
// records what reconciliation did (reconciled / noop / unmatched / no-rule /
// error) — surfaced in Creator Studio → Webhooks → Whop ingestion, where
// unmatched/error rows can be re-reconciled manually once the missing local
// record has landed.
//
// Setup: register this endpoint at Whop (Dashboard → Developers → Webhooks,
// or POST /webhooks {company_id, url, events}) pointing at the deployed
// <public-url>/api/webhooks/whop with the payment.succeeded/payment.failed
// triggers, and set WHOP_WEBHOOK_SECRET here to the endpoint's signing
// secret. For local tunnels (ngrok/cloudflared) the same applies.

const REPLAY_WINDOW_MS = 5 * 60_000;

interface WhopWebhookPayload {
  id?: string; // evt_…
  type?: string;
  data?: Record<string, unknown>;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function verifySvixSignature(secret: string, rawBody: string, id: string, timestamp: string, signatureHeader: string): boolean {
  // Accept "v1,<base64>" (single or space-separated list) and plain "<base64>".
  const candidates = signatureHeader
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    const b64 = candidate.startsWith("v1,") ? candidate.slice(3) : candidate;
    try {
      const signed = `${id}.${timestamp}.${rawBody}`;
      const expected = b64HmacSha256(secret, signed);
      if (timingSafeEqual(expected, b64)) return true;
    } catch {
      // malformed candidate — try the next
    }
  }
  return false;
}

// Node's crypto module does HMAC synchronously (route runs on the server).
function b64HmacSha256(secret: string, content: string): string {
  return createHmac("sha256", secret).update(content, "utf8").digest("base64");
}
function hexHmacSha256(secret: string, content: string): string {
  return createHmac("sha256", secret).update(content, "utf8").digest("hex");
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  const secret = process.env.WHOP_WEBHOOK_SECRET || "";
  if (!secret) {
    // No secret configured — the endpoint is dark. Acknowledge but record.
    await audit({
      actorId: "whop",
      action: AUDIT_ACTIONS.webhookRejected,
      detail: { reason: "WHOP_WEBHOOK_SECRET not configured" },
    });
    return Response.json({ error: "Webhook ingestion not configured." }, { status: 503 });
  }

  const svixId = req.headers.get("webhook-id") || req.headers.get("whop-webhook-id") || "";
  const svixTs = req.headers.get("webhook-timestamp") || req.headers.get("whop-webhook-timestamp") || "";
  const svixSig = req.headers.get("webhook-signature") || req.headers.get("whop-webhook-signature") || "";
  const simpleSig = req.headers.get("x-whop-signature") || "";
  const simpleTs = req.headers.get("x-whop-timestamp") || "";

  // --- Signature verification (svix primary, simple fallback) ---
  let verified = false;
  if (svixId && svixTs && svixSig) {
    verified = verifySvixSignature(secret, rawBody, svixId, svixTs, svixSig);
  } else if (simpleSig && simpleTs) {
    verified = timingSafeEqual(hexHmacSha256(secret, `${simpleTs}.${rawBody}`), simpleSig);
  }
  if (!verified) {
    await audit({
      actorId: "whop",
      action: AUDIT_ACTIONS.webhookRejected,
      detail: { reason: "invalid signature", svix: !!(svixId || svixSig) },
    });
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  // --- Replay protection ---
  const tsMs = Number(svixTs || simpleTs) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > REPLAY_WINDOW_MS) {
    await audit({
      actorId: "whop",
      action: AUDIT_ACTIONS.webhookRejected,
      detail: { reason: "stale timestamp", ts: svixTs || simpleTs },
    });
    return Response.json({ error: "Stale webhook timestamp." }, { status: 401 });
  }

  // --- Parse + event-id dedupe ---
  let payload: WhopWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhopWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const eventId = payload.id || svixId || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const type = payload.type || "unknown";

  let eventRowId: string;
  try {
    const created = await db.whopEvent.create({
      data: { eventId, type, at: await getNow(), payload: rawBody.slice(0, 8000) },
    });
    eventRowId = created.id;
  } catch {
    // Unique violation → already processed. Acknowledge (idempotent 200).
    return Response.json({ received: true, deduped: true });
  }

  // --- Reconciliation (shared with the manual re-reconcile path) ---
  let outcome = "error";
  let outcomeDetail = "";
  try {
    const result = await reconcileWhopEvent(type, payload.data ?? {});
    outcome = result.outcome;
    outcomeDetail = result.note;
  } catch (e) {
    outcomeDetail = e instanceof Error ? e.message : "reconciliation threw";
    console.error("[whop-webhook] reconciliation error", e);
    // 200 anyway — the event is recorded with outcome "error"; the creator
    // studio surfaces it and a manual re-reconcile can retry.
  }
  await db.whopEvent
    .update({ where: { id: eventRowId }, data: { outcome, outcomeDetail } })
    .catch(() => undefined);

  return Response.json({ received: true, outcome });
}

export async function GET() {
  // Health/discovery probe — documents the endpoint without leaking state.
  return Response.json({
    endpoint: "whop-webhook-ingestion",
    signature: "svix (webhook-id/timestamp/signature) + x-whop-signature fallback",
    dedupe: "eventId (unique)",
    handled: ["payment.succeeded", "payment.failed", "payment.refunded", "payment.updated"],
    observability: "GET /api/webhooks/whop/events (creator studio)",
  });
}
