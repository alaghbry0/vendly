import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { reconcileWhopEvent, parseWhopEventPayload } from "@/lib/whop-reconcile";

// POST /api/webhooks/whop/events/[id]/reconcile — manual re-reconcile of a
// recorded Whop event, from the creator studio (Whop ingestion section).
//
// Why this exists: a delivery can legitimately arrive before the local
// record it refers to (checkout commits the invoice-with-whopRef a moment
// after Whop considers the payment settled), or reconciliation can throw
// transiently. The event is recorded either way — this endpoint re-runs the
// SAME shared reconciliation (no money is moved unless the processor's event
// says so; a redelivery would do exactly the same).
//
// Guardrails:
//   • Creator-signed-in only, rate-limited 12/min/user.
//   • Only unmatched / error / no-rule outcomes are retry-worthy — reconciled
//     and noop rows are final (409).
//   • The event row's outcome is updated to the fresh result + audited.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const limited = rateLimit({ req, bucket: "whop-reconcile", userId: user.id, max: 12, windowMs: 60_000 });
    if (limited) return limited;

    const { id } = await params;
    const event = await db.whopEvent.findUnique({ where: { id } });
    if (!event) throw new HttpError(404, "Whop event not found.");
    if (event.outcome === "reconciled" || event.outcome === "noop") {
      throw new HttpError(409, `This event already resolved as "${event.outcome}" — nothing to retry.`);
    }

    const { type, data } = parseWhopEventPayload(event.payload);
    let outcome = "error";
    let outcomeDetail = "";
    try {
      const result = await reconcileWhopEvent(type, data);
      outcome = result.outcome;
      outcomeDetail = result.note;
    } catch (e) {
      outcomeDetail = e instanceof Error ? e.message : "reconciliation threw";
    }
    await db.whopEvent.update({ where: { id: event.id }, data: { outcome, outcomeDetail } });

    await audit({
      actorId: user.id,
      action: AUDIT_ACTIONS.webhookRetry,
      detail: {
        manual: true,
        target: "whop-ingestion",
        eventId: event.eventId,
        type,
        outcome,
        outcomeDetail,
      },
    });

    return Response.json({
      ok: true,
      outcome,
      outcomeDetail,
      message:
        outcome === "reconciled"
          ? "Re-reconciled — the event matched a local record and was applied."
          : outcome === "noop"
            ? "Re-reconciled — the record was already in the right state."
            : outcome === "unmatched"
              ? "Still unmatched — no local invoice for this payment ref yet."
              : "Recorded — no reconciliation rule applies to this event type.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
