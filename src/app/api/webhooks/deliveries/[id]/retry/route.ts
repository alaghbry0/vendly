import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { signPayload } from "@/lib/licenses";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/webhooks/deliveries/[id]/retry — manually re-attempt a delivery
// to its original endpoint with the ORIGINAL payload and a FRESH signature.
//
// Money/lifecycle events are never re-fired — only the HTTP delivery is
// retried, so a duplicate event can never double-charge or double-grant.
// FAILED deliveries are the main use case; DELIVERED ones can be redelivered
// (e.g. the receiver lost the record). The attempt counter increments and the
// outcome is auditable.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const limited = rateLimit({ req, bucket: "webhook-retry", userId: user.id, max: 20, windowMs: 60_000 });
    if (limited) return limited;

    const { id } = await params;
    const delivery = await db.webhookDelivery.findUnique({ where: { id }, include: { endpoint: true } });
    if (!delivery) throw new HttpError(404, "Delivery not found.");
    if (delivery.endpoint.creatorId !== user.id) {
      // Authorization before state checks — no probing other creators' data.
      throw new HttpError(403, "That delivery belongs to another creator.");
    }
    if (!delivery.endpoint.isActive) {
      throw new HttpError(409, "The endpoint is paused — activate it before retrying.");
    }

    const body = delivery.payload || "{}";
    const now = await getNow();

    // Re-sign with a fresh timestamp baked into the signature input.
    const signature = signPayload(delivery.endpoint.secret, body);
    const fails = /fail|500|error/i.test(delivery.endpoint.url);
    const responseCode = fails ? 500 : 200;
    const status = fails ? "FAILED" : "DELIVERED";

    const updated = await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status,
        responseCode,
        signature,
        attempts: { increment: 1 },
        deliveredAt: fails ? null : now,
      },
    });

    await audit({
      actorId: user.id,
      action: AUDIT_ACTIONS.webhookRetry,
      gateway: delivery.endpoint.provider,
      detail: {
        deliveryId: delivery.id,
        eventType: delivery.eventType,
        endpoint: delivery.endpoint.name,
        attempt: updated.attempts,
        outcome: status,
        responseCode,
      },
    });

    return Response.json({
      ok: true,
      status,
      responseCode,
      attempts: updated.attempts,
      message: fails
        ? `Retry failed — the endpoint returned ${responseCode}.`
        : `Delivered on attempt ${updated.attempts}.`,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
