import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow, addInterval } from "@/lib/clock";
import { dispatchEvent, revokeAccess } from "@/lib/webhooks";
import { nextInvoiceNumberRef } from "@/lib/invoice-number";
import { chargeSubscription } from "@/lib/billing";
import { renewalDiscount, recordRedemption } from "@/lib/promos";
import { notify } from "@/lib/notifications";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

// PATCH /api/subscriptions/[id] — lifecycle actions
// body: { action: "cancel"|"cancel_now"|"resume"|"change_plan"|"update_payment"|"retry_charge", planId?, paymentMethodId? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const limited = rateLimit({ req, bucket: "sub-actions", userId: user.id, max: 20, windowMs: 60_000 });
    if (limited) return limited;
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
      if (sub.status === "PENDING") throw new HttpError(409, "This payment is still pending confirmation.");
      if (!["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status)) throw new HttpError(409, "Subscription is not active.");
      if (sub.pendingWhopRef) {
        throw new HttpError(409, "A renewal charge is still settling — try again in a minute.");
      }
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
      if (sub.status === "CANCELED") throw new HttpError(409, "This subscription is already canceled.");
      if (sub.pendingWhopRef) {
        throw new HttpError(409, "A renewal charge is still settling at Whop — try again in a minute so you are not charged for a canceled membership.");
      }
      // Only live memberships were counted in membersCount — never decrement
      // for a PENDING crypto checkout that was never provisioned.
      const wasLive = ["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status);
      await db.subscription.update({
        where: { id },
        data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false },
      });
      await revokeAccess(user.id, sub.productId);
      await db.licenseKey.updateMany({
        where: { subscriptionId: id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      });
      if (wasLive) {
        await db.product.update({ where: { id: sub.productId }, data: { membersCount: { decrement: 1 } } });
      }
      await audit({
        actorId: user.id,
        action: AUDIT_ACTIONS.subscriptionCanceled,
        gateway: sub.gateway,
        subscriptionId: id,
        detail: { reason: "immediate", product: sub.plan.product.title, wasLive },
      });
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
      if (!["ACTIVE", "TRIALING"].includes(sub.status)) {
        // PAST_DUE must not be allowed to "heal" itself into ACTIVE via a
        // tier change (that would dodge dunning and mint a free PAID invoice).
        if (sub.status === "PAST_DUE") {
          throw new HttpError(409, "Your last payment failed — update your payment method in Billing before changing tiers.");
        }
        throw new HttpError(409, "Subscription is not active.");
      }
      if (sub.pendingWhopRef) {
        throw new HttpError(409, "A renewal charge is still settling — try again in a minute.");
      }

      // proration: credit unused time on the old plan
      const totalMs = sub.currentPeriodEnd.getTime() - sub.currentPeriodStart.getTime();
      const remainingMs = Math.max(0, sub.currentPeriodEnd.getTime() - now.getTime());
      const remainingFraction = totalMs > 0 ? remainingMs / totalMs : 0;
      const creditCents = Math.round(sub.plan.priceCents * remainingFraction);
      const amountDue = Math.max(0, newPlan.priceCents - creditCents);

      // Charge the proration difference for real — a tier change must never
      // mint a PAID invoice without money actually moving. $0 switches are
      // free (full credit); Whop card charges must respect the $1 minimum.
      let chargeTxnId: string | undefined;
      if (amountDue > 0) {
        if (sub.gateway === "WHOP" && amountDue < 100) {
          throw new HttpError(
            400,
            `The upgrade difference ($${(amountDue / 100).toFixed(2)}) is below Whop's $1.00 card minimum — try again closer to your renewal date.`
          );
        }
        const charge = await chargeSubscription(
          {
            id: sub.id,
            gateway: sub.gateway,
            paymentMethodId: sub.paymentMethodId,
            paymentMethod: sub.paymentMethod
              ? {
                  whopPaymentMethodId: sub.paymentMethod.whopPaymentMethodId,
                  whopMemberId: sub.paymentMethod.whopMemberId,
                  brand: sub.paymentMethod.brand,
                  last4: sub.paymentMethod.last4,
                  email: sub.paymentMethod.email,
                  walletAddress: sub.paymentMethod.walletAddress,
                }
              : null,
            plan: {
              name: sub.plan.name,
              priceCents: sub.plan.priceCents,
              interval: sub.plan.interval,
              currency: sub.plan.currency,
              product: { title: sub.plan.product.title, slug: sub.plan.product.slug },
            },
          },
          amountDue
        );
        if (!charge.ok) {
          throw new HttpError(402, charge.error || "The proration charge was declined — no changes were made.");
        }
        chargeTxnId = charge.txnId;
      }

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
          createdAt: now,
          whopRef: chargeTxnId?.startsWith("pay_") ? chargeTxnId : null,
        },
      });
      await audit({
        actorId: user.id,
        action: AUDIT_ACTIONS.planChanged,
        gateway: sub.gateway,
        amountCents: amountDue,
        invoiceId: null,
        subscriptionId: id,
        whopRef: chargeTxnId?.startsWith("pay_") ? chargeTxnId : null,
        detail: { from: sub.plan.name, to: newPlan.name, prorationCreditCents: creditCents, chargedCents: amountDue },
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

    // ---- retry_charge (manual dunning retry for a PAST_DUE membership) ----
    // Mirrors the engine's renewal path but runs NOW at the buyer's request
    // instead of waiting for the next daily retry: same discounts, same
    // invoice/event/notification side effects, same dunning burn on failure.
    if (action === "retry_charge") {
      if (sub.status !== "PAST_DUE") throw new HttpError(409, "This subscription isn't past due.");
      if (sub.pendingWhopRef) {
        throw new HttpError(409, "A charge is still settling at Whop — try again in a minute.");
      }

      const promo = await renewalDiscount({
        promoCodeId: sub.promoCodeId,
        promoCyclesUsed: sub.promoCyclesUsed,
        priceCents: sub.plan.priceCents,
      });
      const baseCents = sub.bundleDiscountPct
        ? Math.round((sub.plan.priceCents * (100 - sub.bundleDiscountPct)) / 100)
        : sub.plan.priceCents;
      const chargeAmt = Math.max(0, baseCents - (promo?.discountCents ?? 0));

      const charge = await chargeSubscription(
        {
          id: sub.id,
          gateway: sub.gateway,
          paymentMethodId: sub.paymentMethodId,
          paymentMethod: sub.paymentMethod
            ? {
                whopPaymentMethodId: sub.paymentMethod.whopPaymentMethodId,
                whopMemberId: sub.paymentMethod.whopMemberId,
                brand: sub.paymentMethod.brand,
                last4: sub.paymentMethod.last4,
                email: sub.paymentMethod.email,
                walletAddress: sub.paymentMethod.walletAddress,
              }
            : null,
          plan: {
            name: sub.plan.name,
            priceCents: sub.plan.priceCents,
            interval: sub.plan.interval,
            currency: sub.plan.currency,
            product: { title: sub.plan.product.title, slug: sub.plan.product.slug },
          },
        },
        chargeAmt
      );

      if (charge.ok) {
        // Success — same healing the engine performs: new period starts now,
        // dunning counter resets, a PAID invoice lands, events fire.
        const periodEnd = addInterval(now, sub.plan.interval);
        await db.subscription.update({
          where: { id },
          data: {
            status: "ACTIVE",
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            dunningAttempts: 0,
            cancelAtPeriodEnd: false,
            pendingWhopRef: null,
            pendingWhopRefAt: null,
            promoCyclesUsed: promo ? sub.promoCyclesUsed + 1 : sub.promoCyclesUsed,
          },
        });
        const inv = await db.invoice.create({
          data: {
            number: await nextInvoiceNumberRef(),
            userId: user.id,
            subscriptionId: id,
            productId: sub.productId,
            description: `${sub.plan.product.title} — ${sub.plan.name} (manual retry)${sub.bundleTitle ? ` · ${sub.bundleTitle}` : ""}`,
            amountCents: chargeAmt,
            discountCents: sub.bundleDiscountPct ? sub.plan.priceCents - baseCents : (promo?.discountCents ?? 0),
            promoCode: promo?.code ?? null,
            status: "PAID",
            gateway: sub.gateway,
            whopRef: charge.whopPaymentId ?? null,
            periodStart: now,
            periodEnd,
            paidAt: now,
            createdAt: now,
          },
        });
        if (promo) {
          await recordRedemption({
            promoId: promo.promoId,
            userId: user.id,
            subscriptionId: id,
            invoiceId: inv.id,
            discountCents: promo.discountCents,
          });
        }
        await audit({
          actorId: user.id,
          action: AUDIT_ACTIONS.chargeSucceeded,
          gateway: sub.gateway,
          amountCents: chargeAmt,
          invoiceId: inv.id,
          subscriptionId: id,
          whopRef: charge.whopPaymentId ?? null,
          detail: { phase: "manual-retry", plan: sub.plan.name, product: sub.plan.product.title, attempt: sub.dunningAttempts },
        });
        await dispatchEvent(sub.plan.product.creatorId, "invoice.paid", {
          invoice: { id: inv.id, number: inv.number, amountCents: inv.amountCents },
          subscription: { id, plan: sub.plan.name },
          product: { id: sub.productId, title: sub.plan.product.title },
        });
        await dispatchEvent(sub.plan.product.creatorId, "subscription.renewed", {
          subscription: { id, plan: sub.plan.name, amountCents: chargeAmt },
          product: { id: sub.productId, title: sub.plan.product.title },
        });
        await notify({
          userId: user.id,
          type: "invoice_paid",
          title: `Payment recovered — ${inv.number} · $${(inv.amountCents / 100).toFixed(2)}`,
          body: `${sub.plan.product.title} — ${sub.plan.name} is active again. Next charge ${periodEnd.toLocaleDateString()}.`,
          icon: "receipt",
          at: now,
        });
        return Response.json({
          ok: true,
          message: `Charge succeeded — $${(chargeAmt / 100).toFixed(2)} charged. Your membership is active again until ${periodEnd.toLocaleDateString()}.`,
        });
      }

      if (charge.transient) {
        // Processor/infra issue — do NOT burn a dunning attempt (mirrors the
        // engine's transient handling); the next billing run retries anyway.
        await audit({
          actorId: user.id,
          action: AUDIT_ACTIONS.chargeDeferred,
          gateway: sub.gateway,
          amountCents: chargeAmt,
          subscriptionId: id,
          detail: { phase: "manual-retry", error: charge.error },
        });
        throw new HttpError(402, `${charge.error} — the charge was not attempted again; the next billing run will retry.`);
      }

      // Hard decline — burn a dunning attempt exactly like the engine would,
      // including the 3-strikes cancellation.
      const attempts = sub.dunningAttempts + 1;
      const finalCancel = attempts >= 3;
      const retryAt = addInterval(now, "day");
      await db.subscription.update({
        where: { id },
        data: {
          status: finalCancel ? "CANCELED" : "PAST_DUE",
          dunningAttempts: attempts,
          currentPeriodEnd: finalCancel ? sub.currentPeriodEnd : retryAt,
          canceledAt: finalCancel ? now : null,
          pendingWhopRef: null,
          pendingWhopRefAt: null,
        },
      });
      await db.invoice.create({
        data: {
          number: await nextInvoiceNumberRef(),
          userId: user.id,
          subscriptionId: id,
          productId: sub.productId,
          description: `${sub.plan.product.title} — ${sub.plan.name} (manual retry, attempt #${attempts})`,
          amountCents: chargeAmt,
          discountCents: sub.bundleDiscountPct ? sub.plan.priceCents - baseCents : (promo?.discountCents ?? 0),
          promoCode: promo?.code ?? null,
          status: "FAILED",
          gateway: sub.gateway,
          createdAt: now,
        },
      });
      if (finalCancel) {
        await revokeAccess(user.id, sub.productId);
        await db.licenseKey.updateMany({
          where: { subscriptionId: id, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: now },
        });
        await db.product.update({ where: { id: sub.productId }, data: { membersCount: { decrement: 1 } } });
        await dispatchEvent(sub.plan.product.creatorId, "subscription.canceled", {
          subscription: { id, plan: sub.plan.name, reason: "dunning_exhausted" },
          product: { id: sub.productId, title: sub.plan.product.title },
        });
        await notify({
          userId: user.id,
          type: "subscription_canceled",
          title: `Membership ended — ${sub.plan.product.title}`,
          body: "3 payment attempts failed. Re-subscribe anytime with a working payment method.",
          icon: "x-circle",
          at: now,
        });
      } else {
        await dispatchEvent(sub.plan.product.creatorId, "subscription.past_due", {
          subscription: { id, plan: sub.plan.name, reason: charge.error },
          product: { id: sub.productId, title: sub.plan.product.title },
        });
        await notify({
          userId: user.id,
          type: "payment_failed",
          title: `Retry failed — ${sub.plan.product.title}`,
          body: `${charge.error ?? "Payment declined"} · ${3 - attempts} attempt${3 - attempts === 1 ? "" : "s"} left before cancellation.`,
          icon: "alert",
          at: now,
        });
      }
      await audit({
        actorId: user.id,
        action: AUDIT_ACTIONS.chargeFailed,
        gateway: sub.gateway,
        amountCents: chargeAmt,
        subscriptionId: id,
        detail: { phase: "manual-retry", attempt: attempts, error: charge.error, finalCancel },
      });
      throw new HttpError(
        402,
        finalCancel
          ? `Payment failed for the 3rd time — the membership was canceled and access revoked. Re-subscribe anytime with a working payment method.`
          : `Payment failed (${charge.error}). ${3 - attempts} attempt${3 - attempts === 1 ? "" : "s"} left before cancellation.`
      );
    }

    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    return errorResponse(e);
  }
}
