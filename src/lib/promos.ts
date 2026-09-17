import { db } from "@/lib/db";
import { getNow } from "@/lib/clock";

// ============ Promo code engine ============
// Codes are creator-owned, optionally product-scoped, percent or fixed-amount,
// with optional redemption caps, expiry, and multi-cycle durations. The
// discount applies to each invoice while (cyclesUsed < durationMonths) and the
// code remains active/unexpired/under its redemption cap.

export interface PromoValidation {
  valid: boolean;
  reason?: string;
  promo?: {
    id: string;
    code: string;
    kind: "PERCENT" | "FIXED";
    value: number;
    durationMonths: number;
    maxRedemptions: number;
    timesRedeemed: number;
    expiresAt: string | null;
  };
  discountCents?: number;
  description?: string;
}

export function computeDiscount(
  kind: string,
  value: number,
  priceCents: number
): number {
  if (kind === "PERCENT") return Math.min(priceCents, Math.round((priceCents * value) / 100));
  if (kind === "FIXED") return Math.min(priceCents, value);
  return 0;
}

export function describePromo(kind: string, value: number, durationMonths: number): string {
  const amount = kind === "PERCENT" ? `${value}% off` : `$${(value / 100).toFixed(2)} off`;
  return durationMonths <= 1 ? amount : `${amount} for ${durationMonths} cycles`;
}

// Validates a code for a specific plan purchase (or renewal).
export async function validatePromoForPlan(
  code: string,
  planId: string
): Promise<PromoValidation> {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return { valid: false, reason: "Enter a promo code." };

  const promo = await db.promoCode.findUnique({ where: { code: normalized } });
  if (!promo) return { valid: false, reason: "That code doesn't exist." };
  if (!promo.active) return { valid: false, reason: "This code is no longer active." };

  const now = await getNow();
  if (promo.expiresAt && promo.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "This code has expired." };
  }
  if (promo.maxRedemptions > 0 && promo.timesRedeemed >= promo.maxRedemptions) {
    return { valid: false, reason: "This code has reached its redemption limit." };
  }

  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan) return { valid: false, reason: "Plan not found." };
  if (promo.productId && promo.productId !== plan.productId) {
    return { valid: false, reason: "This code doesn't apply to that product." };
  }

  const discountCents = computeDiscount(promo.kind, promo.value, plan.priceCents);
  if (discountCents <= 0) return { valid: false, reason: "This code has no effect on that plan." };

  return {
    valid: true,
    promo: {
      id: promo.id,
      code: promo.code,
      kind: promo.kind as "PERCENT" | "FIXED",
      value: promo.value,
      durationMonths: promo.durationMonths,
      maxRedemptions: promo.maxRedemptions,
      timesRedeemed: promo.timesRedeemed,
      expiresAt: promo.expiresAt?.toISOString() ?? null,
    },
    discountCents,
    description: describePromo(promo.kind, promo.value, promo.durationMonths),
  };
}

// Records a redemption against an invoice (called whenever a discount is
// actually applied, not merely at checkout).
export async function recordRedemption(opts: {
  promoId: string;
  userId: string;
  subscriptionId: string;
  invoiceId: string | null;
  discountCents: number;
}): Promise<void> {
  await db.promoCode.update({
    where: { id: opts.promoId },
    data: { timesRedeemed: { increment: 1 } },
  });
  await db.promoRedemption.create({
    data: {
      promoId: opts.promoId,
      userId: opts.userId,
      subscriptionId: opts.subscriptionId,
      invoiceId: opts.invoiceId,
      discountCents: opts.discountCents,
    },
  });
}

// Resolves the still-valid discount for an existing subscription's next
// invoice, or null when no discount applies (no code, expired, capped, or
// duration exhausted).
export async function renewalDiscount(sub: {
  promoCodeId: string | null;
  promoCyclesUsed: number;
  priceCents: number;
}): Promise<{ promoId: string; code: string; discountCents: number } | null> {
  if (!sub.promoCodeId) return null;
  const promo = await db.promoCode.findUnique({ where: { id: sub.promoCodeId } });
  if (!promo || !promo.active) return null;

  const now = await getNow();
  if (promo.expiresAt && promo.expiresAt.getTime() <= now.getTime()) return null;
  if (promo.maxRedemptions > 0 && promo.timesRedeemed >= promo.maxRedemptions) return null;
  if (sub.promoCyclesUsed >= promo.durationMonths) return null;

  const discountCents = computeDiscount(promo.kind, promo.value, sub.priceCents);
  if (discountCents <= 0) return null;

  return { promoId: promo.id, code: promo.code, discountCents };
}

export function generatePromoCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
