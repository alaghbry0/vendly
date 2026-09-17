import { db } from "@/lib/db";
import { addInterval, getNow, getClockState } from "@/lib/clock";
import { chargeStoredMethod, type Gateway } from "@/lib/gateways";
import { generateLicenseKey } from "@/lib/licenses";
import { dispatchEvent, grantAccess, revokeAccess } from "@/lib/webhooks";
import { renewalDiscount, recordRedemption } from "@/lib/promos";
import { notify } from "@/lib/notifications";
import { settlePendingPayouts } from "@/lib/payouts";
import { createReferralCommission, settlePendingCommissions } from "@/lib/affiliates";
import { closeExpiredGiveaways } from "@/lib/giveaways";

// ============ Subscription lifecycle engine ============

async function nextInvoiceNumber(): Promise<string> {
  const count = await db.invoice.count();
  return `INV-${(1001 + count).toString()}`;
}

export interface ProvisionResult {
  subscriptionId: string;
  invoiceId: string;
  licenseKeyId: string | null;
  isTrial: boolean;
}

// Called after a successful (or trialing) checkout. Creates the subscription,
// first invoice, license key provisioning and community access grants.
export async function provisionSubscription(opts: {
  userId: string;
  planId: string;
  gateway: Gateway;
  paymentMethodId: string | null;
  chargedNow: boolean; // false when trialing
  txnId?: string;
  promoCodeId?: string | null; // validated promo attached at checkout
  refLinkId?: string | null; // affiliate attribution from a ?ref= link
}): Promise<ProvisionResult> {
  const plan = await db.plan.findUnique({
    where: { id: opts.planId },
    include: { product: true },
  });
  if (!plan) throw new Error("Plan not found");

  const now = await getNow();
  const isTrial = plan.trialDays > 0 && !opts.chargedNow;
  const trialEndsAt = isTrial ? new Date(now.getTime() + plan.trialDays * 86400000) : null;

  // Resolve promo discount for the first charge (0 when none/trialing)
  let promo: { promoId: string; code: string; discountCents: number } | null = null;
  if (opts.promoCodeId && !isTrial) {
    const applied = await renewalDiscount({
      promoCodeId: opts.promoCodeId,
      promoCyclesUsed: 0,
      priceCents: plan.priceCents,
    });
    if (applied) promo = applied;
  }
  const chargeCents = plan.priceCents - (promo?.discountCents ?? 0);

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
    },
  });

  let invoiceId: string | null = null;
  if (!isTrial) {
    const inv = await db.invoice.create({
      data: {
        number: await nextInvoiceNumber(),
        userId: opts.userId,
        subscriptionId: sub.id,
        productId: plan.productId,
        description: `${plan.product.title} — ${plan.name} (${plan.interval}ly)`,
        amountCents: chargeCents,
        discountCents: promo?.discountCents ?? 0,
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
    body: `${plan.name} · $${(chargeCents / 100).toFixed(2)}${promo ? ` (promo ${promo.code})` : ""} · ${opts.gateway.toLowerCase() === "stripe" ? "Stripe" : opts.gateway.toLowerCase() === "paypal" ? "PayPal" : "Crypto"}${isTrial ? ` · trial (${plan.trialDays}d)` : ""}`,
    icon: "user-plus",
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
//  - renews subscriptions whose period ended
//  - honors cancel_at_period_end
//  - moves failing subs to PAST_DUE (dunning) and cancels after 3 failures
//  - converts ended trials to paid
export async function runBilling(): Promise<BillingRunSummary> {
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
    // Promo attached at checkout applies to the conversion charge too
    const promo = await renewalDiscount({
      promoCodeId: sub.promoCodeId,
      promoCyclesUsed: sub.promoCyclesUsed,
      priceCents: sub.plan.priceCents,
    });
    const chargeAmt = sub.plan.priceCents - (promo?.discountCents ?? 0);
    const charge = await chargeStoredMethod(sub.gateway, sub.paymentMethod || {}, chargeAmt);
    if (charge.ok) {
      const periodEnd = addInterval(now, sub.plan.interval);
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialEndsAt: null,
          promoCyclesUsed: promo ? sub.promoCyclesUsed + 1 : sub.promoCyclesUsed,
        },
      });
      const inv = await db.invoice.create({
        data: {
          number: await nextInvoiceNumber(),
          userId: sub.userId,
          subscriptionId: sub.id,
          productId: sub.productId,
          description: `${sub.plan.product.title} — ${sub.plan.name} (trial conversion)`,
          amountCents: chargeAmt,
          discountCents: promo?.discountCents ?? 0,
          promoCode: promo?.code ?? null,
          status: "PAID",
          gateway: sub.gateway,
          periodStart: now,
          periodEnd,
          paidAt: now,
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
        });
      }
      invoicesCreated++;
      trialsConverted++;
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
    } else {
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: "PAST_DUE", dunningAttempts: { increment: 1 } },
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
      });
      canceled++;
      events.push(`Subscription canceled at period end → ${sub.plan.product.title}`);
      continue;
    }

    // Renewal discount (recurring promo still within its cycle window)
    const promo = await renewalDiscount({
      promoCodeId: sub.promoCodeId,
      promoCyclesUsed: sub.promoCyclesUsed,
      priceCents: sub.plan.priceCents,
    });
    const chargeAmt = sub.plan.priceCents - (promo?.discountCents ?? 0);
    const charge = await chargeStoredMethod(sub.gateway, sub.paymentMethod || {}, chargeAmt);
    if (charge.ok) {
      const periodEnd = addInterval(now, sub.plan.interval);
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status: "ACTIVE",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          dunningAttempts: 0,
          promoCyclesUsed: promo ? sub.promoCyclesUsed + 1 : sub.promoCyclesUsed,
        },
      });
      const inv = await db.invoice.create({
        data: {
          number: await nextInvoiceNumber(),
          userId: sub.userId,
          subscriptionId: sub.id,
          productId: sub.productId,
          description: `${sub.plan.product.title} — ${sub.plan.name} (${sub.plan.interval}ly renewal)`,
          amountCents: chargeAmt,
          discountCents: promo?.discountCents ?? 0,
          promoCode: promo?.code ?? null,
          status: "PAID",
          gateway: sub.gateway,
          periodStart: now,
          periodEnd,
          paidAt: now,
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
      });
      events.push(`Renewed → ${sub.plan.product.title} (${sub.plan.name})`);
    } else {
      const attempts = sub.dunningAttempts + 1;
      const finalCancel = attempts >= 3;
      await db.subscription.update({
        where: { id: sub.id },
        data: {
          status: finalCancel ? "CANCELED" : "PAST_DUE",
          dunningAttempts: attempts,
          canceledAt: finalCancel ? now : null,
        },
      });
      await db.invoice.create({
        data: {
          number: await nextInvoiceNumber(),
          userId: sub.userId,
          subscriptionId: sub.id,
          productId: sub.productId,
          description: `${sub.plan.product.title} — ${sub.plan.name} (renewal attempt #${attempts})`,
          amountCents: chargeAmt,
          discountCents: promo?.discountCents ?? 0,
          promoCode: promo?.code ?? null,
          status: "FAILED",
          gateway: sub.gateway,
          createdAt: now,
        },
      });
      renewalsFailed++;
      await dispatchEvent(sub.plan.product.creatorId, "invoice.payment_failed", {
        subscription: { id: sub.id, plan: sub.plan.name, attempt: attempts },
        product: { id: sub.productId, title: sub.plan.product.title },
        error: charge.error,
      });
      await notify({
        userId: sub.userId,
        type: "payment_failed",
        title: `Payment failed — ${sub.plan.product.title}`,
        body: `${charge.error ?? "Payment declined"} · retry #${attempts}${finalCancel ? " — access will be revoked" : " · we'll retry on the next run"}`,
        icon: "alert",
      });
      if (finalCancel) {
        canceled++;
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
export async function advanceDays(days: number): Promise<BillingRunSummary> {
  const now = await getNow();
  const target = new Date(now.getTime() + days * 86400000);
  await db.systemClock.upsert({
    where: { id: "main" },
    update: { simulatedNow: target, label: `Simulated (+${days}d)` },
    create: { id: "main", simulatedNow: target, label: `Simulated (+${days}d)` },
  });
  const summary = await runBilling();
  return { ...summary, advancedDays: days };
}

export async function resetClock(): Promise<void> {
  await db.systemClock.upsert({
    where: { id: "main" },
    update: { simulatedNow: null, label: "Live" },
    create: { id: "main", simulatedNow: null, label: "Live" },
  });
}
