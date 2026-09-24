import { db } from "@/lib/db";
import { addInterval, getNow, getClockState, offsetLabel } from "@/lib/clock";
import { chargeStoredMethod, type Gateway } from "@/lib/gateways";
import { chargeWhopSavedMethod, waitForPayment, WhopApiError } from "@/lib/whop";
import { generateLicenseKey } from "@/lib/licenses";
import { dispatchEvent, grantAccess, revokeAccess } from "@/lib/webhooks";
import { renewalDiscount, recordRedemption } from "@/lib/promos";
import { notify } from "@/lib/notifications";
import { settlePendingPayouts } from "@/lib/payouts";
import { createReferralCommission, settlePendingCommissions } from "@/lib/affiliates";
import { closeExpiredGiveaways } from "@/lib/giveaways";
import { acquireLock, releaseLock } from "@/lib/lock";
import { nextInvoiceNumberRef } from "@/lib/invoice-number";
import { HttpError } from "@/lib/session";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";

// ============ Subscription lifecycle engine ============
//
// Renewal charges:
//   • WHOP gateway → REAL off-session charge against the Whop API using the
//     saved card from checkout (payt_/mber_ references). Only a genuinely
//     settled Whop payment marks an invoice PAID.
//   • STRIPE / PAYPAL / CRYPTO → simulated charges (test-card semantics).
//
// Money-safety invariants (production hardening):
//   1. A Whop charge id is parked on the subscription row the instant it is
//      created — BEFORE settlement polling — so a crash between “charge
//      created” and “charge settled” resumes from the parked payment next
//      run instead of charging again (never double-charge).
//   2. Exactly one engine run may be active at a time, enforced BOTH
//      in-process (fast path) and with a DB advisory lock (cross-process).
//   3. $0 totals (fully discounted) are comped without touching a gateway.
//   4. Transient processor/infra failures defer the renewal — they never
//      burn a dunning attempt.
//   5. Simulated gateways refuse to “renew” a subscription with no stored
//      payment method (no fake successes — mirrors the Whop guard).

// ---------------------------------------------------------------------------
// Charge routing — real Whop path vs simulated gateways
// ---------------------------------------------------------------------------

export interface SubscriptionChargeResult {
  ok: boolean;
  error?: string;
  txnId: string;
  gateway: string;
  /** Infrastructure/processor issue (not the buyer's fault): defer the
   *  renewal — do NOT burn a dunning attempt, do NOT create an invoice. */
  transient?: boolean;
  /** Real Whop payment id (pay_…) when the charge went through Whop. */
  whopPaymentId?: string;
}

export type ChargedSub = {
  id: string;
  gateway: string;
  paymentMethodId?: string | null;
  /** Mutable: lazily loaded pendingWhopRef (undefined = not loaded yet). */
  pendingWhopRef?: string | null;
  pendingWhopRefAt?: Date | null;
  paymentMethod:
    | ({ whopPaymentMethodId: string | null; whopMemberId: string | null } & {
        brand?: string | null;
        last4?: string | null;
        email?: string | null;
        walletAddress?: string | null;
      })
    | null;
  plan: {
    name: string;
    priceCents: number;
    interval: string;
    currency?: string | null;
    product: { title: string; slug: string };
  };
};

function whopInlinePlan(sub: ChargedSub, amountCents: number) {
  return {
    productTitle: sub.plan.product.title,
    productSlug: sub.plan.product.slug,
    planName: sub.plan.name,
    amountDollars: amountCents / 100,
    currency: sub.plan.currency || "usd",
  };
}

// Charges a subscription's stored method. Whop subscriptions charge the
// saved card off-session through the REAL Whop API — with double-charge
// protection via Subscription.pendingWhopRef: the charge id is parked on the
// row the moment it is created (before settlement polling), so a crash can
// never lead to a second charge for the same renewal.
export async function chargeSubscription(sub: ChargedSub, amountCents: number): Promise<SubscriptionChargeResult> {
  // $0 total (fully discounted by a promo/bundle) — comp the invoice without
  // touching a gateway. Never fails, never duns.
  if (amountCents <= 0) {
    const txnId = `comp_${Math.random().toString(36).slice(2, 10)}`;
    await audit({
      actorId: "worker",
      action: AUDIT_ACTIONS.compRenewal,
      gateway: sub.gateway,
      amountCents: 0,
      subscriptionId: sub.id,
      detail: { reason: "fully discounted" },
    });
    return { ok: true, txnId, gateway: sub.gateway };
  }

  if (sub.gateway !== "WHOP") {
    // Simulated gateways: refuse to fake a renewal when there is no stored
    // method on file (e.g. checkout ran with saveMethod:false) — the buyer
    // must add one. Same "no fake success" policy as the Whop path.
    if (!sub.paymentMethodId && !sub.paymentMethod) {
      return {
        ok: false,
        error: "No payment method on file — add one in My Hub → Billing to keep your membership.",
        txnId: "",
        gateway: sub.gateway,
      };
    }
    const r = await chargeStoredMethod(sub.gateway, sub.paymentMethod || {}, amountCents);
    return { ok: r.ok, error: r.error, txnId: r.txnId, gateway: r.gateway };
  }

  const pm = sub.paymentMethod;

  // 1) A previously created off-session charge may have settled since the
  //    last run — check it BEFORE creating a new one (never double-charge).
  if (sub.pendingWhopRef === undefined) {
    const row = await db.subscription.findUnique({
      where: { id: sub.id },
      select: { pendingWhopRef: true, pendingWhopRefAt: true },
    });
    sub.pendingWhopRef = row?.pendingWhopRef ?? null;
    sub.pendingWhopRefAt = row?.pendingWhopRefAt ?? null;
  }
  if (sub.pendingWhopRef) {
    const ref = sub.pendingWhopRef;
    // A charge stuck in requires_action/processing for > 3 platform days is
    // resolved as failed — the buyer never completed verification, so dun
    // them properly instead of deferring the renewal forever.
    const parkedAt = sub.pendingWhopRefAt ?? null;
    const platformNow = await getNow();
    if (parkedAt && platformNow.getTime() - parkedAt.getTime() > 3 * 86400000) {
      await db.subscription
        .update({ where: { id: sub.id }, data: { pendingWhopRef: null, pendingWhopRefAt: null } })
        .catch(() => undefined);
      return {
        ok: false,
        error: "Card verification was not completed in time — update your payment method in My Hub → Billing.",
        txnId: ref,
        gateway: "WHOP",
      };
    }
    try {
      const prior = await waitForPayment(ref, 6000);
      if (prior.kind === "succeeded") {
        await db.subscription
          .update({ where: { id: sub.id }, data: { pendingWhopRef: null, pendingWhopRefAt: null } })
          .catch(() => undefined);
        return { ok: true, txnId: prior.payment.id, gateway: "WHOP", whopPaymentId: prior.payment.id };
      }
      if (prior.kind === "failed") {
        await db.subscription
          .update({ where: { id: sub.id }, data: { pendingWhopRef: null, pendingWhopRefAt: null } })
          .catch(() => undefined);
        return { ok: false, error: prior.message, txnId: ref, gateway: "WHOP" };
      }
      // Still processing — keep waiting, keep the reference.
      return {
        ok: false,
        transient: true,
        error: "Previous charge still processing at Whop — renewal deferred to the next run.",
        txnId: ref,
        gateway: "WHOP",
      };
    } catch (e) {
      // Could not even read the prior payment (Whop unreachable) — defer.
      return {
        ok: false,
        transient: true,
        error: e instanceof Error ? e.message : "Whop unreachable",
        txnId: ref,
        gateway: "WHOP",
      };
    }
  }

  // 2) Buyer-actionable guard: no saved card reference on file (legacy
  //    checkouts from before saved-card renewals, or the method was removed).
  if (!pm?.whopPaymentMethodId || !pm?.whopMemberId) {
    return {
      ok: false,
      error: "No saved card on file at Whop — update your payment method in My Hub → Billing.",
      txnId: "",
      gateway: "WHOP",
    };
  }
  if (amountCents < 100) {
    // Sub-$1 renewal on Whop is a creator-side configuration issue (e.g. a
    // promo brought the price under the card minimum) — NOT the buyer's
    // fault: defer loudly, never dunning.
    return {
      ok: false,
      transient: true,
      error: "Renewal total is below Whop's $1.00 card minimum (discount misconfiguration) — deferred.",
      txnId: "",
      gateway: "WHOP",
    };
  }

  // 3) Create the REAL off-session charge, and park its id BEFORE polling
  //    for settlement — a crash anywhere after this point resumes from the
  //    parked payment instead of charging again.
  let payment;
  try {
    payment = await chargeWhopSavedMethod({
      memberId: pm.whopMemberId,
      paymentMethodId: pm.whopPaymentMethodId,
      plan: whopInlinePlan(sub, amountCents),
      metadata: { subscriptionId: sub.id, amountCents: String(amountCents) },
    });
  } catch (e) {
    if (e instanceof WhopApiError && e.status >= 500) {
      // Processor/infra problem — not the buyer's fault. Defer; the period
      // stays due and the next run retries.
      return { ok: false, transient: true, error: `Whop unreachable (${e.message}) — renewal deferred.`, txnId: "", gateway: "WHOP" };
    }
    if (e instanceof WhopApiError && e.status === 402) {
      return { ok: false, error: e.message, txnId: "", gateway: "WHOP" };
    }
    // 4xx (auth/config/request shape) — our side, not the buyer's card.
    // Defer loudly so the run log surfaces it instead of punishing members.
    return {
      ok: false,
      transient: true,
      error: `Whop API rejected the renewal (${e instanceof Error ? e.message : "unknown"}) — deferred.`,
      txnId: "",
      gateway: "WHOP",
    };
  }

  const parkedAt = await getNow();
  await db.subscription
    .update({ where: { id: sub.id }, data: { pendingWhopRef: payment.id, pendingWhopRefAt: parkedAt } })
    .catch(() => undefined);
  sub.pendingWhopRef = payment.id;
  sub.pendingWhopRefAt = parkedAt;

  const outcome = await waitForPayment(payment.id, 12_000);
  if (outcome.kind === "succeeded") {
    // The caller's success update clears pendingWhopRef; if it crashes first,
    // the next run re-resolves this payment and completes the renewal.
    return { ok: true, txnId: payment.id, gateway: "WHOP", whopPaymentId: payment.id };
  }
  if (outcome.kind === "failed") {
    await db.subscription
      .update({ where: { id: sub.id }, data: { pendingWhopRef: null, pendingWhopRefAt: null } })
      .catch(() => undefined);
    return { ok: false, error: outcome.message, txnId: payment.id, gateway: "WHOP" };
  }
  // Pending: bank verification (3DS) or slow processing. The ref stays
  // parked — the next run resolves it instead of charging again.
  return {
    ok: false,
    transient: true,
    error: "Charge awaiting confirmation at Whop (buyer verification) — carried to the next run.",
    txnId: payment.id,
    gateway: "WHOP",
  };
}

export interface ProvisionResult {
  subscriptionId: string;
  invoiceId: string;
  licenseKeyId: string | null;
  isTrial: boolean;
}

// Called after a successful (or trialing) checkout. Creates the subscription,
// first invoice, license key provisioning and community access grants.
//
// Concurrency: serialized per user with a DB advisory lock — two racing
// checkouts (double-click, 3DS poll + confirm) can never double-provision,
// and the duplicate-subscription guard is re-checked INSIDE the lock.
export async function provisionSubscription(opts: {
  userId: string;
  planId: string;
  gateway: Gateway;
  paymentMethodId: string | null;
  chargedNow: boolean; // false when trialing
  txnId?: string;
  promoCodeId?: string | null; // validated promo attached at checkout
  refLinkId?: string | null; // affiliate attribution from a ?ref= link
  bundle?: { id: string; title: string; discountPct: number }; // bundle checkout — discounted charge, no promo, snapshot on the sub
}): Promise<ProvisionResult> {
  const lockName = `checkout:${opts.userId}`;
  const owner = await acquireLock(lockName, 120_000);
  if (!owner) {
    throw new HttpError(409, "Another checkout is finishing up for your account — try again in a moment.");
  }
  try {
    return await provisionSubscriptionInner(opts);
  } finally {
    await releaseLock(lockName, owner);
  }
}

async function provisionSubscriptionInner(opts: {
  userId: string;
  planId: string;
  gateway: Gateway;
  paymentMethodId: string | null;
  chargedNow: boolean;
  txnId?: string;
  promoCodeId?: string | null;
  refLinkId?: string | null;
  bundle?: { id: string; title: string; discountPct: number };
}): Promise<ProvisionResult> {
  const plan = await db.plan.findUnique({
    where: { id: opts.planId },
    include: { product: true },
  });
  if (!plan) throw new Error("Plan not found");

  // Duplicate guard re-checked under the per-user lock — the single source of
  // truth for "one live subscription per product per user". Every provisioning
  // path (all gateways, bundles, 3DS polls) funnels through here.
  const dup = await db.subscription.findFirst({
    where: {
      userId: opts.userId,
      productId: plan.productId,
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "PENDING"] },
    },
  });
  if (dup) {
    throw new HttpError(409, "You already have a subscription to this product — manage it from your portal.");
  }

  const now = await getNow();
  const isTrial = plan.trialDays > 0 && !opts.chargedNow;
  const trialEndsAt = isTrial ? new Date(now.getTime() + plan.trialDays * 86400000) : null;

  // Resolve promo discount for the first charge (0 when none/trialing).
  // Bundle checkouts carry no promo — the bundle discount replaces it.
  let promo: { promoId: string; code: string; discountCents: number } | null = null;
  if (opts.promoCodeId && !isTrial && !opts.bundle) {
    const applied = await renewalDiscount({
      promoCodeId: opts.promoCodeId,
      promoCyclesUsed: 0,
      priceCents: plan.priceCents,
    });
    if (applied) promo = applied;
  }
  const chargeCents = opts.bundle
    ? Math.round((plan.priceCents * (100 - opts.bundle.discountPct)) / 100)
    : plan.priceCents - (promo?.discountCents ?? 0);

  const periodStart = now;
  const periodEnd = addInterval(now, plan.interval);

  const sub = await db.subscription.create({
    data: {
      userId: opts.userId,
      planId: plan.id,
      productId: plan.productId,
      status: isTrial ? "TRIALING" : "ACTIVE",
      gateway: opts.gateway,
      paymentMethodId: opts.paymentMethodId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: isTrial && trialEndsAt ? trialEndsAt : periodEnd,
      trialEndsAt,
      promoCodeId: opts.promoCodeId ?? null,
      promoCyclesUsed: promo ? 1 : 0,
      refLinkId: opts.refLinkId ?? null,
      bundleId: opts.bundle?.id ?? null,
      bundleTitle: opts.bundle?.title ?? null,
      bundleDiscountPct: opts.bundle?.discountPct ?? null,
    },
  });

  // Audit: the provision itself (trial start vs first charge).
  await audit({
    actorId: opts.userId,
    action: isTrial ? AUDIT_ACTIONS.trialStarted : AUDIT_ACTIONS.checkoutCharged,
    gateway: opts.gateway,
    amountCents: isTrial ? 0 : chargeCents,
    invoiceId: null,
    subscriptionId: sub.id,
    detail: {
      plan: plan.name,
      product: plan.product.title,
      txnId: opts.txnId,
      bundle: opts.bundle?.title ?? null,
      promo: promo?.code ?? null,
    },
  });

  let invoiceId: string | null = null;
  if (!isTrial) {
    const inv = await db.invoice.create({
      data: {
        number: await nextInvoiceNumberRef(),
        userId: opts.userId,
        subscriptionId: sub.id,
        productId: plan.productId,
        description: `${plan.product.title} — ${plan.name} (${plan.interval}ly)${opts.bundle ? ` · ${opts.bundle.title}` : ""}`,
        amountCents: chargeCents,
        discountCents: opts.bundle ? plan.priceCents - chargeCents : (promo?.discountCents ?? 0),
        promoCode: promo?.code ?? null,
        status: "PAID",
        gateway: opts.gateway,
        periodStart,
        periodEnd,
        paidAt: now,
        createdAt: now,
      },
    });
    invoiceId = inv.id;
    if (promo) {
      await recordRedemption({
        promoId: promo.promoId,
        userId: opts.userId,
        subscriptionId: sub.id,
        invoiceId: inv.id,
        discountCents: promo.discountCents,
      });
      await notify({
        userId: plan.product.creatorId,
        type: "promo_redeemed",
        title: `Promo ${promo.code} redeemed`,
        body: `${plan.product.title} — ${plan.name} · −$${(promo.discountCents / 100).toFixed(2)} applied`,
        icon: "tag",
        at: now,
      });
    }
    await dispatchEvent(plan.product.creatorId, "invoice.paid", {
      invoice: { id: inv.id, number: inv.number, amountCents: inv.amountCents },
      subscription: { id: sub.id, plan: plan.name },
      product: { id: plan.productId, title: plan.product.title },
      customer: { id: opts.userId },
      txn: opts.txnId,
    });
    await notify({
      userId: opts.userId,
      type: "invoice_paid",
      title: `Payment received — ${inv.number} · $${(inv.amountCents / 100).toFixed(2)}`,
      body: `${plan.product.title} — ${plan.name}${promo ? ` · promo ${promo.code} (−$${(promo.discountCents / 100).toFixed(2)})` : ""}`,
      icon: "receipt",
      at: now,
    });

    // Affiliate attribution: mint a PENDING commission for the referrer
    if (opts.refLinkId) {
      await createReferralCommission({
        refLinkId: opts.refLinkId,
        subscriptionId: sub.id,
        invoiceAmountCents: inv.amountCents,
      });
    }
  }

  // License key provisioning
  let licenseKeyId: string | null = null;
  const providers = (plan.product.accessType || "").split(",").map((s) => s.trim());
  if (providers.includes("LICENSE")) {
    const lk = await db.licenseKey.create({
      data: {
        key: generateLicenseKey(),
        userId: opts.userId,
        productId: plan.productId,
        subscriptionId: sub.id,
        status: "ACTIVE",
        planName: plan.name,
      },
    });
    licenseKeyId = lk.id;
    await dispatchEvent(plan.product.creatorId, "license_key.created", {
      license: { id: lk.id, key: lk.key, plan: plan.name },
      product: { id: plan.productId, title: plan.product.title },
      customer: { id: opts.userId },
    });
    await notify({
      userId: opts.userId,
      type: "license_created",
      title: `License key provisioned — ${plan.product.title}`,
      body: "Your key is ready in My Hub → Licenses. Activate it on up to 3 devices.",
      icon: "key",
      at: now,
    });
  }

  await grantAccess(opts.userId, plan.productId, {
    discordRoleName: plan.product.discordRoleName,
    telegramChannel: plan.product.telegramChannel,
  });

  await dispatchEvent(plan.product.creatorId, "subscription.created", {
    subscription: {
      id: sub.id,
      status: sub.status,
      plan: plan.name,
      amountCents: plan.priceCents,
      interval: plan.interval,
      gateway: opts.gateway,
    },
    product: { id: plan.productId, title: plan.product.title },
    customer: { id: opts.userId },
  });
  await notify({
    userId: plan.product.creatorId,
    type: "subscription_created",
    title: `New subscriber — ${plan.product.title}`,
    body: `${plan.name} · $${(chargeCents / 100).toFixed(2)}${promo ? ` (promo ${promo.code})` : ""} · ${opts.gateway.toLowerCase() === "stripe" ? "Stripe" : opts.gateway.toLowerCase() === "paypal" ? "PayPal" : opts.gateway.toLowerCase() === "whop" ? "Whop" : "Crypto"}${isTrial ? ` · trial (${plan.trialDays}d)` : ""}`,
    icon: "user-plus",
    at: now,
  });

  // bump members count
  await db.product.update({
    where: { id: plan.productId },
    data: { membersCount: { increment: 1 } },
  });

  return { subscriptionId: sub.id, invoiceId: invoiceId || "", licenseKeyId, isTrial };
}

export interface BillingRunSummary {
  advancedDays: number;
  newNow: string;
  renewals: number;
  renewalsFailed: number;
  canceled: number;
  trialsConverted: number;
  invoicesCreated: number;
  events: string[];
}

// The recurring billing engine. Runs against the (possibly simulated) clock:
//  - renews subscriptions whose period ended (Whop gateway → REAL charges)
//  - honors cancel_at_period_end
//  - moves failing subs to PAST_DUE (dunning) and cancels after 3 failures
//  - converts ended trials to paid
//
// Concurrency: only ONE engine run may be active — Whop renewals are real
// charges, so an overlapping run could double-charge. Enforced twice:
// an in-process flag (fast path) AND a DB advisory lock (cross-process /
// isolated route-module contexts). The worker tick and the time machine
// both funnel through these guards.
let billingRunInFlight = false;

export async function runBilling(): Promise<BillingRunSummary> {
  if (billingRunInFlight) {
    const clock = await getClockState();
    return {
      advancedDays: 0,
      newNow: clock.now,
      renewals: 0,
      renewalsFailed: 0,
      canceled: 0,
      trialsConverted: 0,
      invoicesCreated: 0,
      events: ["Skipped — another billing run is already in flight"],
    };
  }
  billingRunInFlight = true;
  try {
    const owner = await acquireLock("billing-engine");
    if (!owner) {
      const clock = await getClockState();
      return {
        advancedDays: 0,
        newNow: clock.now,
        renewals: 0,
        renewalsFailed: 0,
        canceled: 0,
        trialsConverted: 0,
        invoicesCreated: 0,
        events: ["Skipped — another process holds the billing-engine lock"],
      };
    }
    try {
      return await runBillingEngine();
    } finally {
      await releaseLock("billing-engine", owner);
    }
  } finally {
    billingRunInFlight = false;
  }
}

async function runBillingEngine(): Promise<BillingRunSummary> {
  const now = await getNow();
  const events: string[] = [];
  let renewals = 0,
    renewalsFailed = 0,
    canceled = 0,
    trialsConverted = 0,
    invoicesCreated = 0;

  // 1) Trials that ended
  const endedTrials = await db.subscription.findMany({
    where: { status: "TRIALING", trialEndsAt: { lte: now } },
    include: { plan: { include: { product: true } }, paymentMethod: true },
  });
  for (const sub of endedTrials) {
    // Promo attached at checkout applies to the conversion charge too.
    // Bundle-origin subs renew at their persistent bundle discount (guard —
    // bundle checkouts never trial, but be safe if one ever does).
    const promo = await renewalDiscount({
      promoCodeId: sub.promoCodeId,
      promoCyclesUsed: sub.promoCyclesUsed,
      priceCents: sub.plan.priceCents,
    });
    const baseCents = sub.bundleDiscountPct
      ? Math.round((sub.plan.priceCents * (100 - sub.bundleDiscountPct)) / 100)
      : sub.plan.priceCents;
    const chargeAmt = baseCents - (promo?.discountCents ?? 0);
    const charge = await chargeSubscription(sub, chargeAmt);
    if (charge.ok) {
      const periodEnd = addInterval(now, sub.plan.interval);
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialEndsAt: null,
          pendingWhopRef: null,
          pendingWhopRefAt: null,
          promoCyclesUsed: promo ? sub.promoCyclesUsed + 1 : sub.promoCyclesUsed,
        },
      });
      const inv = await db.invoice.create({
        data: {
          number: await nextInvoiceNumberRef(),
          userId: sub.userId,
          subscriptionId: sub.id,
          productId: sub.productId,
          description: `${sub.plan.product.title} — ${sub.plan.name} (trial conversion)${sub.bundleTitle ? ` · ${sub.bundleTitle}` : ""}`,
          amountCents: chargeAmt,
          discountCents: sub.bundleDiscountPct
            ? sub.plan.priceCents - baseCents
            : (promo?.discountCents ?? 0),
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
          userId: sub.userId,
          subscriptionId: sub.id,
          invoiceId: inv.id,
          discountCents: promo.discountCents,
        });
        await notify({
          userId: sub.plan.product.creatorId,
          type: "promo_redeemed",
          title: `Promo ${promo.code} redeemed`,
          body: `${sub.plan.product.title} trial converted with −$${(promo.discountCents / 100).toFixed(2)}`,
          icon: "tag",
          at: now,
        });
      }
      invoicesCreated++;
      trialsConverted++;
      await audit({
        actorId: "worker",
        action: AUDIT_ACTIONS.trialConverted,
        gateway: sub.gateway,
        amountCents: chargeAmt,
        invoiceId: inv.id,
        subscriptionId: sub.id,
        whopRef: charge.whopPaymentId ?? null,
        detail: { plan: sub.plan.name, product: sub.plan.product.title },
      });
      await dispatchEvent(sub.plan.product.creatorId, "invoice.paid", {
        invoice: { id: inv.id, number: inv.number, amountCents: inv.amountCents },
        subscription: { id: sub.id, plan: sub.plan.name },
        product: { id: sub.productId, title: sub.plan.product.title },
      });
      await notify({
        userId: sub.userId,
        type: "invoice_paid",
        title: `Trial ended — charged $${(inv.amountCents / 100).toFixed(2)}`,
        body: `${sub.plan.product.title} — ${sub.plan.name} · your subscription is now active`,
        icon: "receipt",
        at: now,
      });
      // Referred trial converting to paid: the referrer earns their commission now
      if (sub.refLinkId) {
        await createReferralCommission({
          refLinkId: sub.refLinkId,
          subscriptionId: sub.id,
          invoiceAmountCents: inv.amountCents,
        });
      }
      events.push(`Trial converted → ${sub.plan.product.title} (${sub.plan.name})`);
    } else if (charge.transient) {
      events.push(`Trial conversion deferred → ${sub.plan.product.title} · ${charge.error}`);
    } else {
      // Dunning cadence: retry once per platform day (mirrors real
      // processors). The period end doubles as the next-retry marker.
      const retryAt = addInterval(now, "day");
      const attempts = sub.dunningAttempts + 1;
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: "PAST_DUE", dunningAttempts: attempts, currentPeriodEnd: retryAt, pendingWhopRef: null, pendingWhopRefAt: null },
      });
      await db.invoice.create({
        data: {
          number: await nextInvoiceNumberRef(),
          userId: sub.userId,
          subscriptionId: sub.id,
          productId: sub.productId,
          description: `${sub.plan.product.title} — ${sub.plan.name} (trial conversion, attempt #${attempts})`,
          amountCents: chargeAmt,
          discountCents: sub.bundleDiscountPct ? sub.plan.priceCents - baseCents : (promo?.discountCents ?? 0),
          promoCode: promo?.code ?? null,
          status: "FAILED",
          gateway: sub.gateway,
          createdAt: now,
        },
      });
      renewalsFailed++;
      await audit({
        actorId: "worker",
        action: AUDIT_ACTIONS.chargeFailed,
        gateway: sub.gateway,
        amountCents: chargeAmt,
        invoiceId: null,
        subscriptionId: sub.id,
        detail: { phase: "trial-conversion", attempt: attempts, error: charge.error },
      });
      await dispatchEvent(sub.plan.product.creatorId, "subscription.past_due", {
        subscription: { id: sub.id, plan: sub.plan.name, reason: charge.error },
        product: { id: sub.productId, title: sub.plan.product.title },
      });
      await notify({
        userId: sub.userId,
        type: "payment_failed",
        title: `Trial charge failed — ${sub.plan.product.title}`,
        body: `${charge.error ?? "Payment declined"} · update your payment method to keep access.`,
        icon: "alert",
        at: now,
      });
      events.push(`Trial charge failed → ${sub.plan.product.title}`);
    }
  }

  // 2) Periods that ended
  const due = await db.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "PAST_DUE"] },
      currentPeriodEnd: { lte: now },
    },
    include: { plan: { include: { product: true } }, paymentMethod: true },
    orderBy: { currentPeriodEnd: "asc" },
  });

  for (const sub of due) {
    // honor cancel at period end
    if (sub.cancelAtPeriodEnd) {
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: "CANCELED", canceledAt: now },
      });
      await revokeAccess(sub.userId, sub.productId);
      await db.licenseKey.updateMany({
        where: { subscriptionId: sub.id, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      });
      await db.product.update({ where: { id: sub.productId }, data: { membersCount: { decrement: 1 } } });
      await dispatchEvent(sub.plan.product.creatorId, "subscription.canceled", {
        subscription: { id: sub.id, plan: sub.plan.name, reason: "at_period_end" },
        product: { id: sub.productId, title: sub.plan.product.title },
      });
      await notify({
        userId: sub.userId,
        type: "subscription_canceled",
        title: `Membership ended — ${sub.plan.product.title}`,
        body: "Your subscription reached its period end and was canceled as requested. Community roles and license keys were revoked.",
        icon: "x-circle",
        at: now,
      });
      canceled++;
      events.push(`Subscription canceled at period end → ${sub.plan.product.title}`);
      await audit({
        action: AUDIT_ACTIONS.subscriptionCanceled,
        actorId: sub.userId,
        gateway: sub.gateway,
        subscriptionId: sub.id,
        detail: { reason: "at_period_end", product: sub.plan.product.title },
      });
      continue;
    }

    // Renewal discount (recurring promo still within its cycle window).
    // Bundle-origin subscriptions keep their bundle discount for life.
    const promo = await renewalDiscount({
      promoCodeId: sub.promoCodeId,
      promoCyclesUsed: sub.promoCyclesUsed,
      priceCents: sub.plan.priceCents,
    });
    const baseCents = sub.bundleDiscountPct
      ? Math.round((sub.plan.priceCents * (100 - sub.bundleDiscountPct)) / 100)
      : sub.plan.priceCents;
    const chargeAmt = baseCents - (promo?.discountCents ?? 0);
    const charge = await chargeSubscription(sub, chargeAmt);
    if (charge.ok) {
      const periodEnd = addInterval(now, sub.plan.interval);
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          dunningAttempts: 0,
          pendingWhopRef: null,
          pendingWhopRefAt: null,
          promoCyclesUsed: promo ? sub.promoCyclesUsed + 1 : sub.promoCyclesUsed,
        },
      });
      const inv = await db.invoice.create({
        data: {
          number: await nextInvoiceNumberRef(),
          userId: sub.userId,
          subscriptionId: sub.id,
          productId: sub.productId,
          description: `${sub.plan.product.title} — ${sub.plan.name} (${sub.plan.interval}ly renewal)${sub.bundleTitle ? ` · ${sub.bundleTitle}` : ""}`,
          amountCents: chargeAmt,
          discountCents: sub.bundleDiscountPct
            ? sub.plan.priceCents - baseCents
            : (promo?.discountCents ?? 0),
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
          userId: sub.userId,
          subscriptionId: sub.id,
          invoiceId: inv.id,
          discountCents: promo.discountCents,
        });
      }
      invoicesCreated++;
      renewals++;
      await audit({
        actorId: "worker",
        action: AUDIT_ACTIONS.chargeSucceeded,
        gateway: sub.gateway,
        amountCents: chargeAmt,
        invoiceId: inv.id,
        subscriptionId: sub.id,
        whopRef: charge.whopPaymentId ?? null,
        detail: { phase: "renewal", plan: sub.plan.name, product: sub.plan.product.title, attempt: sub.dunningAttempts },
      });
      await dispatchEvent(sub.plan.product.creatorId, "invoice.paid", {
        invoice: { id: inv.id, number: inv.number, amountCents: inv.amountCents },
        subscription: { id: sub.id, plan: sub.plan.name },
        product: { id: sub.productId, title: sub.plan.product.title },
      });
      await dispatchEvent(sub.plan.product.creatorId, "subscription.renewed", {
        subscription: { id: sub.id, plan: sub.plan.name, amountCents: chargeAmt },
        product: { id: sub.productId, title: sub.plan.product.title },
      });
      await notify({
        userId: sub.userId,
        type: "invoice_paid",
        title: `Renewal charged — ${inv.number} · $${(inv.amountCents / 100).toFixed(2)}`,
        body: `${sub.plan.product.title} — ${sub.plan.name}${promo ? ` · promo ${promo.code} (−$${(promo.discountCents / 100).toFixed(2)})` : ""}`,
        icon: "receipt",
        at: now,
      });
      events.push(
        `Renewed → ${sub.plan.product.title} (${sub.plan.name})${charge.whopPaymentId ? ` · Whop ${charge.whopPaymentId}` : ""}`
      );
    } else if (charge.transient) {
      // Processor/infra issue or an in-flight charge — NOT the buyer's fault.
      // Leave the subscription untouched (period stays due → retried next
      // run) and surface it in the run log. No invoice, no dunning burn.
      await audit({
        actorId: "worker",
        action: AUDIT_ACTIONS.chargeDeferred,
        gateway: sub.gateway,
        amountCents: chargeAmt,
        subscriptionId: sub.id,
        detail: { phase: "renewal", error: charge.error },
      });
      events.push(`Renewal deferred → ${sub.plan.product.title} · ${charge.error}`);
    } else {
      const attempts = sub.dunningAttempts + 1;
      const finalCancel = attempts >= 3;
      // Dunning cadence: retry once per platform day (real-processor
      // behavior) — also prevents a failed trial conversion from being
      // retried by the renewal loop within the same run.
      const retryAt = finalCancel ? sub.currentPeriodEnd : addInterval(now, "day");
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status: finalCancel ? "CANCELED" : "PAST_DUE",
          dunningAttempts: attempts,
          canceledAt: finalCancel ? now : null,
          pendingWhopRef: null,
          pendingWhopRefAt: null,
          ...(finalCancel ? {} : { currentPeriodEnd: retryAt }),
        },
      });
      await db.invoice.create({
        data: {
          number: await nextInvoiceNumberRef(),
          userId: sub.userId,
          subscriptionId: sub.id,
          productId: sub.productId,
          description: `${sub.plan.product.title} — ${sub.plan.name} (renewal attempt #${attempts})${sub.bundleTitle ? ` · ${sub.bundleTitle}` : ""}`,
          amountCents: chargeAmt,
          discountCents: sub.bundleDiscountPct
            ? sub.plan.priceCents - baseCents
            : (promo?.discountCents ?? 0),
          promoCode: promo?.code ?? null,
          status: "FAILED",
          gateway: sub.gateway,
          createdAt: now,
        },
      });
      renewalsFailed++;
      await audit({
        actorId: "worker",
        action: AUDIT_ACTIONS.chargeFailed,
        gateway: sub.gateway,
        amountCents: chargeAmt,
        subscriptionId: sub.id,
        detail: { phase: "renewal", attempt: attempts, finalCancel, error: charge.error },
      });
      await dispatchEvent(sub.plan.product.creatorId, "invoice.payment_failed", {
        subscription: { id: sub.id, plan: sub.plan.name, attempt: attempts },
        product: { id: sub.productId, title: sub.plan.product.title },
        error: charge.error,
      });
      await notify({
        userId: sub.userId,
        type: "payment_failed",
        title: `Payment failed — ${sub.plan.product.title}`,
        body: `${charge.error ?? "Payment declined"} · attempt ${attempts} of 3${finalCancel ? " — access will be revoked" : " — we'll retry tomorrow (update your card in Billing to keep access)"}`,
        icon: "alert",
        at: now,
      });
      if (finalCancel) {
        canceled++;
        await audit({
          action: AUDIT_ACTIONS.subscriptionCanceledEngine,
          actorId: "worker",
          gateway: sub.gateway,
          subscriptionId: sub.id,
          detail: { reason: "dunning_exhausted", attempts: 3, product: sub.plan.product.title },
        });
        await revokeAccess(sub.userId, sub.productId);
        await db.licenseKey.updateMany({
          where: { subscriptionId: sub.id, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: now },
        });
        await db.product.update({ where: { id: sub.productId }, data: { membersCount: { decrement: 1 } } });
        await dispatchEvent(sub.plan.product.creatorId, "subscription.canceled", {
          subscription: { id: sub.id, plan: sub.plan.name, reason: "dunning_exhausted" },
          product: { id: sub.productId, title: sub.plan.product.title },
        });
        await notify({
          userId: sub.userId,
          type: "subscription_canceled",
          title: `Membership ended — ${sub.plan.product.title}`,
          body: "We couldn't process payment after 3 attempts, so the subscription was canceled and access revoked.",
          icon: "x-circle",
          at: now,
        });
        events.push(`Dunning exhausted, canceled → ${sub.plan.product.title}`);
      } else {
        await dispatchEvent(sub.plan.product.creatorId, "subscription.past_due", {
          subscription: { id: sub.id, plan: sub.plan.name, attempt: attempts },
          product: { id: sub.productId, title: sub.plan.product.title },
        });
        events.push(`Charge failed (attempt ${attempts}) → ${sub.plan.product.title}`);
      }
    }
  }

  // 4) Settle pending creator payouts (the settlement window closes when the
  // billing engine runs — i.e. each time-machine advance).
  const payoutsSettled = await settlePendingPayouts(now);
  if (payoutsSettled > 0) events.push(`${payoutsSettled} payout${payoutsSettled === 1 ? "" : "s"} settled`);

  // 5) Settle pending affiliate commissions on the same cadence.
  const commissionsSettled = await settlePendingCommissions(now);
  if (commissionsSettled > 0)
    events.push(`${commissionsSettled} affiliate commission${commissionsSettled === 1 ? "" : "s"} settled`);

  // 6) Close expired giveaways and draw their winners.
  const giveawaysDrawn = await closeExpiredGiveaways(now);
  if (giveawaysDrawn > 0)
    events.push(`${giveawaysDrawn} giveaway${giveawaysDrawn === 1 ? "" : "s"} ended — winners drawn`);

  const clock = await getClockState();
  return {
    advancedDays: 0,
    newNow: clock.now,
    renewals,
    renewalsFailed,
    canceled,
    trialsConverted,
    invoicesCreated,
    events,
  };
}

// Time machine: advances the simulated clock then runs the billing engine.
// The clock stores the simulated instant + the real moment it was captured;
// getNow() keeps ticking from there, so the jump stays a constant offset.
export async function advanceDays(days: number): Promise<BillingRunSummary> {
  const now = await getNow();
  const realNow = new Date();
  const target = new Date(now.getTime() + days * 86400000);
  const label = `Simulated (${offsetLabel(target.getTime() - realNow.getTime())})`;
  await db.systemClock.upsert({
    where: { id: "main" },
    update: { simulatedNow: target, simulatedSetAt: realNow, label },
    create: { id: "main", simulatedNow: target, simulatedSetAt: realNow, label },
  });
  const summary = await runBilling();
  return { ...summary, advancedDays: days };
}

export async function resetClock(): Promise<void> {
  await db.systemClock.upsert({
    where: { id: "main" },
    update: { simulatedNow: null, simulatedSetAt: null, label: "Live" },
    create: { id: "main", simulatedNow: null, simulatedSetAt: null, label: "Live" },
  });
}
