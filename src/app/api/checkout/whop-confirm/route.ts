import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { provisionSubscription } from "@/lib/billing";
import {
  assertBundlePurchasable,
  bundleReceiptItems,
  loadBundleForCheckout,
  provisionBundle,
} from "@/lib/bundles";
import { validatePromoForPlan } from "@/lib/promos";
import { resolveReferral } from "@/lib/affiliates";
import {
  WhopApiError,
  classifyPayment,
  createWhopPayment,
  createWhopSetupIntent,
  waitForPayment,
  waitForSetupIntent,
  whopSavedCardRef,
  type WhopCardInfo,
  type WhopPayment,
  type WhopSetupIntent,
} from "@/lib/whop";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/checkout/whop-confirm — confirms a Whop Elements checkout.
//
// body: { planId, confirmationToken (ctok_… from the element),
//         startTrial?, promoCode?, refCode? }
//
// Non-trial: the token is confirmed as a REAL one-time card payment against
// the Whop sandbox API (POST /payments with an inline find-or-create plan).
// Trial:     the card is validated + saved via a setup intent (nothing charged).
//
// Response: { status: "COMPLETED", …receipt }  — charge settled, subscription provisioned
//         or { status: "PENDING_ACTION", whopRef, clientSecret } — buyer must
//           finish 3DS; the client runs handleNextAction then polls
//           GET /api/checkout/whop-status?ref=…
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const limited = rateLimit({ req, bucket: "whop-confirm", userId: user.id, max: 10, windowMs: 60_000 });
    if (limited) return limited;
    const body = await req.json().catch(() => ({}));

    const planId = String(body.planId || "");
    const confirmationToken = String(body.confirmationToken || "");
    if (!/^ctok_/.test(confirmationToken)) throw new HttpError(400, "Missing or invalid confirmation token.");

    const cardMeta = (card: WhopCardInfo | null | undefined) => ({
      brand: card?.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Card",
      last4: card?.last4 ?? null,
      expMonth: card?.exp_month ?? null,
      expYear: card?.exp_year ?? null,
    });

    const returnUrl =
      req.headers.get("origin")?.startsWith("http") && !req.headers.get("origin")!.includes("localhost")
        ? `${req.headers.get("origin")}/`
        : "https://vendly.example/checkout";

    // Saved-card references (payt_/mber_) from a payment or setup intent —
    // what the billing engine charges off-session on renewal.
    const whopRefs = (src: WhopPayment | WhopSetupIntent) => {
      const refs = whopSavedCardRef(src);
      return { whopPaymentMethodId: refs.paymentMethodId, whopMemberId: refs.memberId };
    };

    // ------------------------------------------------------------------
    // BUNDLE CHECKOUT — one real Whop payment for every product in the
    // bundle. Body carries { bundleId, confirmationToken } instead of planId.
    // ------------------------------------------------------------------
    if (body.bundleId) {
      const loaded = await loadBundleForCheckout(String(body.bundleId));
      await assertBundlePurchasable(user.id, loaded); // 409 before charging
      if (loaded.totalCents < 100) {
        throw new HttpError(400, "Whop card payments must be at least $1.00 — pick another payment method for this bundle.");
      }
      let payment;
      try {
        payment = await createWhopPayment({
          confirmationToken,
          email: user.email,
          plan: {
            productTitle: loaded.bundle.title,
            productSlug: `bundle-${loaded.bundle.slug}`,
            planName: `${loaded.items.length}-product bundle`,
            amountDollars: loaded.totalCents / 100,
            currency: "usd",
          },
          returnUrl,
          metadata: { bundleId: loaded.bundle.id, userId: user.id },
        });
      } catch (e) {
        if (e instanceof WhopApiError) throw new HttpError(e.status >= 500 ? 502 : 402, e.message);
        throw e;
      }

      const outcome = await waitForPayment(payment.id);
      if (outcome.kind === "failed") throw new HttpError(402, outcome.message);

      if (outcome.kind === "pending") {
        return Response.json(
          { status: "PENDING_ACTION", kind: "payment", bundle: true, whopRef: payment.id, clientSecret: outcome.clientSecret },
          { status: 202 }
        );
      }

      const card = cardMeta(outcome.payment.payment_instrument?.card);
      const pm = await db.paymentMethod.create({
        data: {
          userId: user.id,
          type: "CARD",
          gateway: "WHOP",
          brand: card.brand,
          last4: card.last4,
          expMonth: card.expMonth,
          expYear: card.expYear,
          // Saved-card references for REAL off-session renewals:
          // the element mounts with setupFutureUsage "off_session", so the
          // tokenized method (payt_…) + member (mber_…) come back on the
          // payment and are what future charges use.
          ...whopRefs(outcome.payment),
        },
      });
      const { results } = await provisionBundle({
        userId: user.id,
        loaded,
        gateway: "WHOP",
        paymentMethodId: pm.id,
        txnId: outcome.payment.id,
        whopRef: outcome.payment.id,
      });
      return Response.json(
        {
          status: "COMPLETED",
          bundle: { id: loaded.bundle.id, title: loaded.bundle.title, discountPct: loaded.bundle.discountPct },
          subtotalCents: loaded.subtotalCents,
          discountCents: loaded.discountCents,
          totalCents: loaded.totalCents,
          items: bundleReceiptItems(loaded, results),
          whopRef: outcome.payment.id,
          whop: {
            paymentId: outcome.payment.id,
            amount: outcome.payment.total?.amount ?? (loaded.totalCents / 100).toFixed(2),
            currency: (outcome.payment.total?.currency || "usd").toUpperCase(),
            card: `${card.brand} •••• ${card.last4 ?? "----"}`,
          },
        },
        { status: 201 }
      );
    }

    const plan = await db.plan.findUnique({ where: { id: planId }, include: { product: true } });
    if (!plan || !plan.active) throw new HttpError(404, "Plan not found.");
    if (plan.product.status !== "ACTIVE") throw new HttpError(400, "This product is not accepting new members.");

    // Idempotency guard: a completed whop checkout for this user+plan returns
    // its existing receipt instead of provisioning twice (e.g. 3DS poll races).
    const existingSub = await db.subscription.findFirst({
      where: { userId: user.id, productId: plan.productId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "PENDING"] } },
      include: { invoices: { take: 1, orderBy: { createdAt: "desc" } } },
    });

    const startTrial = !!body.startTrial && plan.trialDays > 0;

    // Promo validation (same rules as the simulated gateways)
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

    // Referral attribution (soft — invalid codes ignored)
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

    // ------------------------------------------------------------------
    // TRIAL — save + validate the card via a Whop setup intent, no charge.
    // ------------------------------------------------------------------
    if (startTrial) {
      if (existingSub) throw new HttpError(409, "You already have a subscription to this product — manage it from your portal.");
      const created = await createWhopSetupIntent({
        confirmationToken,
        metadata: { planId: plan.id, userId: user.id, trial: "1" },
      });
      // Sandbox setup intents settle in a couple of seconds — wait briefly
      // server-side so the common case completes synchronously (mirrors the
      // payment path's waitForPayment). "processing" past the deadline falls
      // back to client-side polling via whop-status.
      const setup = await waitForSetupIntent(created.id);
      if (setup.status === "succeeded") {
        const card = cardMeta(setup.payment_method?.card);
        const pm = await db.paymentMethod.create({
          data: {
            userId: user.id,
            type: "CARD",
            gateway: "WHOP",
            brand: card.brand,
            last4: card.last4,
            expMonth: card.expMonth,
            expYear: card.expYear,
            // Setup intents store the card for later — keep the payt_/mber_
            // references so the trial conversion charges the REAL card.
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
          refLinkId,
        });
        await db.invoice.updateMany({
          where: { subscriptionId: result.subscriptionId },
          data: { whopRef: setup.id },
        });
        return Response.json(
          { status: "COMPLETED", ...result, discountCents, promoCode: promoCodeLabel, referral: refMeta, whopRef: setup.id },
          { status: 201 }
        );
      }
      if (setup.status === "requires_action" || setup.status === "processing") {
        return Response.json(
          { status: "PENDING_ACTION", kind: "setup", whopRef: setup.id, clientSecret: setup.client_secret ?? null },
          { status: 202 }
        );
      }
      throw new HttpError(402, setup.error_message || "We couldn't save your card. Try another payment method.");
    }

    // ------------------------------------------------------------------
    // PAID CHECKOUT — confirm a real one-time card payment via Whop.
    // ------------------------------------------------------------------
    if (chargeCents < 100) {
      throw new HttpError(400, "Whop card payments must be at least $1.00 — remove the promo or pick another payment method.");
    }
    let payment;
    try {
      payment = await createWhopPayment({
        confirmationToken,
        email: user.email,
        plan: {
          productTitle: plan.product.title,
          productSlug: plan.product.slug,
          planName: plan.name,
          amountDollars: chargeCents / 100,
          currency: plan.currency || "usd",
        },
        returnUrl,
        metadata: { planId: plan.id, userId: user.id },
      });
    } catch (e) {
      if (e instanceof WhopApiError) throw new HttpError(e.status >= 500 ? 502 : 402, e.message);
      throw e;
    }

    // Let the charge settle (test cards resolve in a couple of seconds).
    const outcome = await waitForPayment(payment.id);
    if (outcome.kind === "failed") throw new HttpError(402, outcome.message);

    if (outcome.kind === "pending") {
      if (existingSub) throw new HttpError(409, "You already have a subscription to this product — manage it from your portal.");
      return Response.json(
        { status: "PENDING_ACTION", kind: "payment", whopRef: payment.id, clientSecret: outcome.clientSecret },
        { status: 202 }
      );
    }

    // Succeeded — provision (idempotent against an existing active sub).
    if (existingSub) {
      return Response.json(
        {
          status: "COMPLETED",
          subscriptionId: existingSub.id,
          invoiceId: existingSub.invoices[0]?.id ?? "",
          licenseKeyId: null,
          isTrial: existingSub.status === "TRIALING",
          discountCents,
          promoCode: promoCodeLabel,
          referral: refMeta,
          whopRef: payment.id,
        },
        { status: 200 }
      );
    }

    const card = cardMeta(outcome.payment.payment_instrument?.card);
    const pm = await db.paymentMethod.create({
      data: {
        userId: user.id,
        type: "CARD",
        gateway: "WHOP",
        brand: card.brand,
        last4: card.last4,
        expMonth: card.expMonth,
        expYear: card.expYear,
        // Saved-card references for REAL off-session renewals.
        ...whopRefs(outcome.payment),
      },
    });
    const result = await provisionSubscription({
      userId: user.id,
      planId: plan.id,
      gateway: "WHOP",
      paymentMethodId: pm.id,
      chargedNow: true,
      txnId: outcome.payment.id,
      promoCodeId,
      refLinkId,
    });
    if (result.invoiceId) {
      await db.invoice.update({ where: { id: result.invoiceId }, data: { whopRef: outcome.payment.id } });
    }
    return Response.json(
      {
        status: "COMPLETED",
        ...result,
        discountCents,
        promoCode: promoCodeLabel,
        referral: refMeta,
        whopRef: outcome.payment.id,
        whop: {
          paymentId: outcome.payment.id,
          amount: outcome.payment.total?.amount ?? (chargeCents / 100).toFixed(2),
          currency: (outcome.payment.total?.currency || plan.currency || "usd").toUpperCase(),
          card: `${card.brand} •••• ${card.last4 ?? "----"}`,
        },
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
