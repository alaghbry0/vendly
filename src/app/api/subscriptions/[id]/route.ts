import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow, addInterval } from "@/lib/clock";
import { dispatchEvent, revokeAccess } from "@/lib/webhooks";
import { nextInvoiceNumberRef } from "@/lib/invoice-number";

// PATCH /api/subscriptions/[id] — lifecycle actions
// body: { action: "cancel"|"cancel_now"|"resume"|"change_plan"|"update_payment", planId?, paymentMethodId? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    const sub = await db.subscription.findUnique({
      where: { id },
      include: { plan: { include: { product: true } }, paymentMethod: true },
    });
    if (!sub) throw new HttpError(404, "Subscription not found.");
    if (sub.userId !== user.id) throw new HttpError(403, "Not your subscription.");

    const now = await getNow();

    // ---- cancel at period end ----
    if (action === "cancel") {
      if (!["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status)) throw new HttpError(409, "Subscription is not active.");
      await db.subscription.update({ where: { id }, data: { cancelAtPeriodEnd: true } });
      return Response.json({ ok: true, message: `Access continues until ${sub.currentPeriodEnd.toLocaleDateString()}, then cancels automatically.` });
    }

    // ---- resume (undo cancel at period end) ----
    if (action === "resume") {
      if (!sub.cancelAtPeriodEnd) throw new HttpError(409, "This subscription isn't scheduled to cancel.");
      await db.subscription.update({ where: { id }, data: { cancelAtPeriodEnd: false } });
      return Response.json({ ok: true, message: "Subscription resumed — auto-renew is back on." });
    }

    // ---- immediate cancellation ----
    if (action === "cancel_now") {
      await db.subscription.update({
        where: { id },
        data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false },
      });
      await revokeAccess(user.id, sub.productId);
      await db.licenseKey.updateMany({
        where: { subscriptionId: id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      });
      await db.product.update({ where: { id: sub.productId }, data: { membersCount: { decrement: 1 } } });
      await dispatchEvent(sub.plan.product.creatorId, "subscription.canceled", {
        subscription: { id, plan: sub.plan.name, reason: "immediate" },
        product: { id: sub.productId, title: sub.plan.product.title },
      });
      return Response.json({ ok: true, message: "Subscription canceled immediately. Access and license keys revoked." });
    }

    // ---- change plan (upgrade/downgrade with proration credit) ----
    if (action === "change_plan") {
      const newPlanId = String(body.planId || "");
      const newPlan = await db.plan.findUnique({ where: { id: newPlanId }, include: { product: true } });
      if (!newPlan || newPlan.productId !== sub.productId) throw new HttpError(400, "Choose a tier of the same product.");
      if (newPlan.id === sub.planId) throw new HttpError(400, "You're already on this tier.");
      if (!["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status)) throw new HttpError(409, "Subscription is not active.");

      // proration: credit unused time on the old plan
      const totalMs = sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime();
      const remainingMs = Math.max(0, sub.currentPeriodEnd.getTime() - now.getTime());
      const remainingFraction = totalMs > 0 ? remainingMs / totalMs : 0;
      const creditCents = Math.round(sub.plan.priceCents * remainingFraction);
      const amountDue = Math.max(0, newPlan.priceCents - creditCents);

      const periodStart = now;
      const periodEnd = addInterval(now, newPlan.interval);

      await db.subscription.update({
        where: { id },
        data: {
          planId: newPlan.id,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          status: "ACTIVE",
          dunningAttempts: 0,
          cancelAtPeriodEnd: false,
        },
      });

      await db.invoice.create({
        data: {
          number: await nextInvoiceNumberRef(),
          userId: user.id,
          subscriptionId: id,
          productId: sub.productId,
          description: `Tier change: ${sub.plan.name} → ${newPlan.name} (proration credit −$${(creditCents / 100).toFixed(2)})`,
          amountCents: amountDue,
          status: "PAID",
          gateway: sub.gateway,
          periodStart,
          periodEnd,
          paidAt: now,
        },
      });
      await dispatchEvent(sub.plan.product.creatorId, "subscription.updated", {
        subscription: { id, from: sub.plan.name, to: newPlan.name, prorationCreditCents: creditCents, chargedCents: amountDue },
        product: { id: sub.productId, title: sub.plan.product.title },
      });
      return Response.json({
        ok: true,
        message: `Switched to ${newPlan.name}. Proration credit −$${(creditCents / 100).toFixed(2)} applied, charged $${(amountDue / 100).toFixed(2)} today.`,
      });
    }

    // ---- update payment method ----
    if (action === "update_payment") {
      const pmId = String(body.paymentMethodId || "");
      const pm = await db.paymentMethod.findUnique({ where: { id: pmId } });
      if (!pm || pm.userId !== user.id) throw new HttpError(400, "Invalid payment method.");
      await db.subscription.update({ where: { id }, data: { paymentMethodId: pmId, gateway: pm.gateway } });
      return Response.json({ ok: true, message: `Future renewals will charge your ${pm.type === "CARD" ? `${pm.brand} ••••${pm.last4}` : pm.type === "PAYPAL" ? "PayPal account" : "crypto wallet"}.` });
    }

    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    return errorResponse(e);
  }
}
