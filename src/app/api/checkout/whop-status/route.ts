import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { provisionSubscription } from "@/lib/billing";
import {
  assertBundlePurchasable,
  bundleReceiptItems,
  loadBundleForCheckout,
  provisionBundle,
} from "@/lib/bundles";
import { getWhopPayment, getWhopSetupIntent, classifyPayment, whopSavedCardRef, type WhopPayment, type WhopSetupIntent } from "@/lib/whop";

// Rebuilds bundle receipt line items from an existing purchase — one row per
// provisioned subscription (latest invoice), used for idempotent status polls.
async function bundleItemsFromPurchase(bundleId: string, userId: string) {
  const subs = await db.subscription.findMany({
    where: { bundleId, userId },
    include: { plan: true, product: true, invoices: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return subs.map((s) => ({
    productTitle: s.product.title,
    planName: s.plan.name,
    subscriptionId: s.id,
    invoiceId: s.invoices[0]?.id ?? "",
    licenseKeyId: null,
    amountCents: s.invoices[0]?.amountCents ?? 0,
    interval: s.plan.interval,
  }));
}

// Saved-card references (payt_/mber_) from a payment or setup intent.
const whopRefs = (src: WhopPayment | WhopSetupIntent) => {
  const refs = whopSavedCardRef(src);
  return { whopPaymentMethodId: refs.paymentMethodId, whopMemberId: refs.memberId };
};

// GET /api/checkout/whop-status?ref=pay_…|sint_…&planId=…&promoCode=…&refCode=…
//                    or ?ref=pay_…&bundleId=…  (bundle checkout polling)
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

    // ------------------------------------------------------------------
    // BUNDLE CHECKOUT POLLING — ?ref=pay_…&bundleId=…
    // ------------------------------------------------------------------
    const bundleIdParam = url.searchParams.get("bundleId");
    if (bundleIdParam) {
      if (!/^pay_/.test(ref)) throw new HttpError(400, "Missing or invalid Whop reference.");

      // Idempotency: a settled bundle purchase for this whop ref returns the
      // same receipt instead of provisioning twice.
      const existingPurchase = await db.bundlePurchase.findFirst({
        where: { whopRef: ref, userId: user.id },
        include: { bundle: true },
      });
      if (existingPurchase) {
        return Response.json({
          status: "COMPLETED",
          purchaseId: existingPurchase.id,
          bundle: {
            id: existingPurchase.bundleId,
            title: existingPurchase.bundle.title,
            discountPct: existingPurchase.bundle.discountPct,
          },
          subtotalCents: existingPurchase.subtotalCents,
          discountCents: existingPurchase.discountCents,
          totalCents: existingPurchase.totalCents,
          items: await bundleItemsFromPurchase(existingPurchase.bundleId, user.id),
          whopRef: ref,
        });
      }

      const loaded = await loadBundleForCheckout(bundleIdParam);
      await assertBundlePurchasable(user.id, loaded);

      const payment = await getWhopPayment(ref);
      const outcome = classifyPayment(payment);
      if (outcome.kind === "failed") throw new HttpError(402, outcome.message);
      if (outcome.kind === "pending") {
        return Response.json(
          { status: "PENDING", bundle: true, whopRef: ref, clientSecret: payment.client_secret },
          { status: 202 }
        );
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
          // Saved-card references for REAL off-session renewals.
          ...whopRefs(payment),
        },
      });
      const { purchase, results } = await provisionBundle({
        userId: user.id,
        loaded,
        gateway: "WHOP",
        paymentMethodId: pm.id,
        txnId: payment.id,
        whopRef: payment.id,
      });
      return Response.json(
        {
          status: "COMPLETED",
          purchaseId: purchase.id,
          bundle: { id: loaded.bundle.id, title: loaded.bundle.title, discountPct: loaded.bundle.discountPct },
          subtotalCents: loaded.subtotalCents,
          discountCents: loaded.discountCents,
          totalCents: loaded.totalCents,
          items: bundleReceiptItems(loaded, results),
          whopRef: payment.id,
          whop: {
            paymentId: payment.id,
            amount: payment.total?.amount ?? (loaded.totalCents / 100).toFixed(2),
            currency: (payment.total?.currency || "usd").toUpperCase(),
            card: card ? `${card.brand} •••• ${card.last4}` : "Card",
          },
        },
        { status: 201 }
      );
    }

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
            // Setup intent card — keep the payt_/mber_ references for the
            // real trial-conversion charge.
            ...whopRefs(setup),
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
        // Saved-card references for REAL off-session renewals.
        ...whopRefs(payment),
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
