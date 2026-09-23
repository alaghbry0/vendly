import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { provisionSubscription } from "@/lib/billing";
import { getWhopPayment, getWhopSetupIntent, classifyPayment } from "@/lib/whop";

// GET /api/checkout/whop-status?ref=pay_…|sint_…&planId=…&promoCode=…&refCode=…
//
// Polls a Whop payment/setup-intent after the buyer completed a pending step
// (3DS). When the charge settles, the subscription is provisioned here and
// the standard checkout receipt is returned — idempotently.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const ref = url.searchParams.get("ref") || "";
    const planId = url.searchParams.get("planId") || "";
    if (!/^(pay|sint)_/.test(ref)) throw new HttpError(400, "Missing or invalid Whop reference.");
    if (!planId) throw new HttpError(400, "Missing planId.");

    const plan = await db.plan.findUnique({ where: { id: planId }, include: { product: true } });
    if (!plan) throw new HttpError(404, "Plan not found.");

    // Already provisioned for this whop ref? Return the same receipt.
    const paidInvoice = await db.invoice.findFirst({
      where: { whopRef: ref, userId: user.id },
      include: { subscription: true },
    });
    if (paidInvoice?.subscription) {
      return Response.json({
        status: "COMPLETED",
        subscriptionId: paidInvoice.subscriptionId,
        invoiceId: paidInvoice.id,
        licenseKeyId: null,
        isTrial: paidInvoice.subscription.status === "TRIALING",
        discountCents: paidInvoice.discountCents,
        promoCode: paidInvoice.promoCode,
        referral: null,
        whopRef: ref,
      });
    }

    // Still pending an active sub on this product? Can't double-provision.
    const existingSub = await db.subscription.findFirst({
      where: { userId: user.id, productId: plan.productId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "PENDING"] } },
      include: { invoices: { take: 1, orderBy: { createdAt: "desc" } } },
    });

    const promoCode = url.searchParams.get("promoCode");
    let promoCodeId: string | null = null;
    let discountCents = 0;
    let promoCodeLabel: string | null = null;
    if (promoCode) {
      const { validatePromoForPlan } = await import("@/lib/promos");
      const check = await validatePromoForPlan(promoCode, plan.id);
      if (check.valid) {
        promoCodeId = check.promo!.id;
        promoCodeLabel = check.promo!.code;
        discountCents = check.discountCents!;
      }
    }

    let refCodeId: string | null = null;
    let refMeta: { code: string; affiliateName: string | null; commissionCents: number } | null = null;
    const refCode = url.searchParams.get("refCode");
    if (refCode) {
      const { resolveReferral } = await import("@/lib/affiliates");
      const r = await resolveReferral(refCode, plan.productId, user.id);
      if (!("error" in r)) {
        refCodeId = r.linkId;
        refMeta = {
          code: r.code,
          affiliateName: r.affiliateName,
          commissionCents: Math.round((Math.max(0, plan.priceCents - discountCents) * r.commissionBps) / 10000),
        };
      }
    }

    // ---- Setup intent (trial card save) ----
    if (ref.startsWith("sint_")) {
      const setup = await getWhopSetupIntent(ref);
      if (setup.status === "succeeded") {
        if (existingSub) {
          return Response.json({
            status: "COMPLETED",
            subscriptionId: existingSub.id,
            invoiceId: existingSub.invoices[0]?.id ?? "",
            licenseKeyId: null,
            isTrial: existingSub.status === "TRIALING",
            discountCents,
            promoCode: promoCodeLabel,
            referral: refMeta,
            whopRef: ref,
          });
        }
        const card = setup.payment_method?.card;
        const pm = await db.paymentMethod.create({
          data: {
            userId: user.id,
            type: "CARD",
            gateway: "WHOP",
            brand: card?.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Card",
            last4: card?.last4 ?? null,
            expMonth: card?.exp_month ?? null,
            expYear: card?.exp_year ?? null,
          },
        });
        const result = await provisionSubscription({
          userId: user.id,
          planId: plan.id,
          gateway: "WHOP",
          paymentMethodId: pm.id,
          chargedNow: false,
          txnId: setup.id,
          promoCodeId,
          refLinkId: refCodeId,
        });
        await db.invoice.updateMany({ where: { subscriptionId: result.subscriptionId }, data: { whopRef: ref } });
        return Response.json(
          { status: "COMPLETED", ...result, discountCents, promoCode: promoCodeLabel, referral: refMeta, whopRef: ref },
          { status: 201 }
        );
      }
      if (setup.status === "failed" || setup.status === "canceled") {
        throw new HttpError(402, setup.error_message || "Card verification failed. Please try again.");
      }
      return Response.json({ status: "PENDING", whopRef: ref }, { status: 202 });
    }

    // ---- Payment (paid checkout) ----
    const payment = await getWhopPayment(ref);
    const outcome = classifyPayment(payment);
    if (outcome.kind === "failed") throw new HttpError(402, outcome.message);
    if (outcome.kind === "pending") {
      return Response.json({ status: "PENDING", whopRef: ref, clientSecret: payment.client_secret }, { status: 202 });
    }

    if (existingSub) {
      return Response.json({
        status: "COMPLETED",
        subscriptionId: existingSub.id,
        invoiceId: existingSub.invoices[0]?.id ?? "",
        licenseKeyId: null,
        isTrial: existingSub.status === "TRIALING",
        discountCents,
        promoCode: promoCodeLabel,
        referral: refMeta,
        whopRef: ref,
      });
    }

    const card = payment.payment_instrument?.card;
    const pm = await db.paymentMethod.create({
      data: {
        userId: user.id,
        type: "CARD",
        gateway: "WHOP",
        brand: card?.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Card",
        last4: card?.last4 ?? null,
        expMonth: card?.exp_month ?? null,
        expYear: card?.exp_year ?? null,
      },
    });
    const result = await provisionSubscription({
      userId: user.id,
      planId: plan.id,
      gateway: "WHOP",
      paymentMethodId: pm.id,
      chargedNow: true,
      txnId: payment.id,
      promoCodeId,
      refLinkId: refCodeId,
    });
    if (result.invoiceId) {
      await db.invoice.update({ where: { id: result.invoiceId }, data: { whopRef: payment.id } });
    }
    return Response.json(
      {
        status: "COMPLETED",
        ...result,
        discountCents,
        promoCode: promoCodeLabel,
        referral: refMeta,
        whopRef: payment.id,
        whop: {
          paymentId: payment.id,
          amount: payment.total?.amount ?? (plan.priceCents / 100).toFixed(2),
          currency: (payment.total?.currency || plan.currency || "usd").toUpperCase(),
          card: card ? `${card.brand} •••• ${card.last4}` : "Card",
        },
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
