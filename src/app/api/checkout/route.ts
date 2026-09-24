import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { chargeStripeCard, chargePaypal, quoteCrypto, detectCardBrand, type Gateway } from "@/lib/gateways";
import { provisionSubscription } from "@/lib/billing";
import { validatePromoForPlan } from "@/lib/promos";
import { resolveReferral } from "@/lib/affiliates";
import { getNow } from "@/lib/clock";
import { rateLimit } from "@/lib/rate-limit";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

// POST /api/checkout — multi-gateway subscription checkout
// body: { planId, gateway: STRIPE|PAYPAL|CRYPTO, card?: {number,expMonth,expYear,cvc},
//         paypalEmail?, walletAddress?, saveMethod?, startTrial?, promoCode?, refCode? }
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const limited = rateLimit({ req, bucket: "checkout", userId: user.id, max: 10, windowMs: 60_000 });
    if (limited) {
      await audit({ actorId: user.id, action: AUDIT_ACTIONS.rateLimited, detail: { endpoint: "checkout" } });
      return limited;
    }
    const body = await req.json().catch(() => ({}));

    const planId = String(body.planId || "");
    const gateway = String(body.gateway || "") as Gateway;
    if (!["STRIPE", "PAYPAL", "CRYPTO"].includes(gateway)) throw new HttpError(400, "Unsupported payment gateway.");
    const plan = await db.plan.findUnique({ where: { id: planId }, include: { product: true } });
    if (!plan || !plan.active) throw new HttpError(404, "Plan not found.");
    if (plan.product.status !== "ACTIVE") throw new HttpError(400, "This product is not accepting new members.");

    // Block duplicate active subscriptions on the same product
    const existing = await db.subscription.findFirst({
      where: { userId: user.id, productId: plan.productId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "PENDING"] } },
    });
    if (existing) throw new HttpError(409, "You already have a subscription to this product — manage it from your portal.");

    const startTrial = !!body.startTrial && plan.trialDays > 0;

    // Promo code — validated server-side against the plan being purchased
    let promoCodeId: string | null = null;
    let discountCents = 0;
    let promoCodeLabel: string | null = null;
    if (body.promoCode) {
      const check = await validatePromoForPlan(String(body.promoCode), plan.id);
      if (!check.valid) throw new HttpError(400, check.reason || "Invalid promo code.");
      promoCodeId = check.promo!.id;
      promoCodeLabel = check.promo!.code;
      discountCents = check.discountCents!;
    }
    const chargeCents = startTrial ? 0 : Math.max(0, plan.priceCents - discountCents);

    // Referral attribution (?ref=CODE landing) — soft-validated: an invalid
    // code is ignored (checkout never blocks on it), a valid one attaches.
    let refLinkId: string | null = null;
    let refMeta: { code: string; affiliateName: string | null; commissionCents: number } | null = null;
    if (body.refCode) {
      const ref = await resolveReferral(String(body.refCode), plan.productId, user.id);
      if (!("error" in ref)) {
        refLinkId = ref.linkId;
        refMeta = {
          code: ref.code,
          affiliateName: ref.affiliateName,
          commissionCents: startTrial ? 0 : Math.round((chargeCents * ref.commissionBps) / 10000),
        };
      }
    }

    // ---------- STRIPE ----------
    if (gateway === "STRIPE") {
      const card = body.card || {};
      const number = String(card.number || "").replace(/\s/g, "");
      const charge = await chargeStripeCard(
        { number, expMonth: Number(card.expMonth), expYear: Number(card.expYear), cvc: String(card.cvc || "") },
        startTrial ? 0 : chargeCents
      );
      if (!charge.ok) throw new HttpError(402, charge.error || "Payment failed.");

      let pmId: string | null = null;
      if (body.saveMethod !== false) {
        const pm = await db.paymentMethod.create({
          data: {
            userId: user.id,
            type: "CARD",
            gateway: "STRIPE",
            brand: detectCardBrand(number),
            last4: number.slice(-4),
            expMonth: Number(card.expMonth),
            expYear: Number(card.expYear),
          },
        });
        pmId = pm.id;
      }
      const result = await provisionSubscription({
        userId: user.id,
        planId: plan.id,
        gateway: "STRIPE",
        paymentMethodId: pmId,
        chargedNow: !startTrial,
        txnId: charge.txnId,
        promoCodeId,
        refLinkId,
      });
      return Response.json(
        { status: "COMPLETED", ...result, discountCents, promoCode: promoCodeLabel, referral: refMeta },
        { status: 201 }
      );
    }

    // ---------- PAYPAL ----------
    if (gateway === "PAYPAL") {
      const email = String(body.paypalEmail || "").trim().toLowerCase();
      const charge = await chargePaypal(email, startTrial ? 0 : chargeCents);
      if (!charge.ok) throw new HttpError(402, charge.error || "PayPal payment failed.");

      let pmId: string | null = null;
      if (body.saveMethod !== false) {
        const pm = await db.paymentMethod.create({
          data: { userId: user.id, type: "PAYPAL", gateway: "PAYPAL", email },
        });
        pmId = pm.id;
      }
      const result = await provisionSubscription({
        userId: user.id,
        planId: plan.id,
        gateway: "PAYPAL",
        paymentMethodId: pmId,
        chargedNow: !startTrial,
        txnId: charge.txnId,
        promoCodeId,
        refLinkId,
      });
      return Response.json(
        { status: "COMPLETED", ...result, discountCents, promoCode: promoCodeLabel, referral: refMeta },
        { status: 201 }
      );
    }

    // ---------- CRYPTO ----------
    const walletAddress = String(body.walletAddress || "").trim();
    if (!/^0x[a-fA-F0-9]{6,}$/.test(walletAddress)) {
      throw new HttpError(400, "Enter a valid EVM wallet address (0x…).");
    }
    const pm = await db.paymentMethod.create({
      data: { userId: user.id, type: "CRYPTO", gateway: "CRYPTO", walletAddress, chain: "ETH" },
    });
    // Crypto: create a PENDING subscription and wait for on-chain confirmations.
    const now = await getNow(); // platform clock — consistent with the engine
    const trialEndsAt = startTrial ? new Date(now.getTime() + plan.trialDays * 86400000) : null;
    const sub = await db.subscription.create({
      data: {
        userId: user.id,
        planId: plan.id,
        productId: plan.productId,
        status: "PENDING",
        gateway: "CRYPTO",
        paymentMethodId: pm.id,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86400000),
        trialEndsAt,
        promoCodeId,
        refLinkId,
        dunningAttempts: -1, // marker: awaiting 1st crypto payment
      },
    });
    const quote = quoteCrypto(startTrial ? 0 : chargeCents);
    return Response.json(
      {
        status: "PENDING_CRYPTO",
        subscriptionId: sub.id,
        quote,
        discountCents,
        promoCode: promoCodeLabel,
        referral: refMeta,
        plan: { id: plan.id, name: plan.name, priceCents: plan.priceCents, interval: plan.interval },
      },
      { status: 202 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
