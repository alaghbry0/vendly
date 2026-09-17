import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { provisionSubscription } from "@/lib/billing";

// POST /api/checkout/crypto-confirm { subscriptionId } — simulate on-chain
// confirmations landing, then provision the subscription.
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const subId = String(body.subscriptionId || "");

    const sub = await db.subscription.findUnique({
      where: { id: subId },
      include: { plan: { include: { product: true } }, paymentMethod: true },
    });
    if (!sub) throw new HttpError(404, "Pending payment not found.");
    if (sub.userId !== user.id) throw new HttpError(403, "Not your payment.");
    if (sub.status !== "PENDING") throw new HttpError(409, "This payment is no longer pending.");

    const wasTrial = sub.trialEndsAt != null;
    const paymentMethodId = sub.paymentMethodId;

    // Recreate the subscription through the standard provisioning pipeline
    await db.subscription.delete({ where: { id: sub.id } });
    const result = await provisionSubscription({
      userId: user.id,
      planId: sub.planId,
      gateway: "CRYPTO",
      paymentMethodId,
      chargedNow: !wasTrial,
      txnId: `0x${Math.random().toString(16).slice(2, 12)}`,
    });
    return Response.json({ status: "COMPLETED", ...result });
  } catch (e) {
    return errorResponse(e);
  }
}
