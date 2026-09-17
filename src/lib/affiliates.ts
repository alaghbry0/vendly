import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";

// ============ Affiliate & referral engine ============
// Creators open an affiliate program per product (commission in basis points
// of the referred member's FIRST invoice). Any user can join an active program
// to get a shareable referral link (?ref=CODE). Clicks are tracked when a
// visitor lands with a ref code; a conversion mints a PENDING commission which
// settles to PAID the next time the billing engine runs — mirroring payout
// settlement windows.

export interface ReferralResolution {
  linkId: string;
  code: string;
  affiliateId: string;
  affiliateName: string | null;
  commissionBps: number;
  productId: string;
  productTitle: string;
}

export function generateReferralCode(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // lowercase, no ambiguous chars
  let out = "";
  for (let i = 0; i < 7; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// Resolves a ?ref= code for a specific product checkout/landing.
export async function resolveReferral(
  code: string,
  productId: string,
  buyerId?: string
): Promise<ReferralResolution | { error: string }> {
  const normalized = String(code || "").trim().toLowerCase();
  if (!normalized) return { error: "Missing referral code." };

  const link = await db.affiliateLink.findUnique({
    where: { code: normalized },
    include: { program: { include: { product: true } }, user: true },
  });
  if (!link || !link.active) return { error: "That referral link doesn't exist." };
  if (!link.program.active) return { error: "This affiliate program has ended." };
  if (link.program.productId !== productId) return { error: "That referral link points to a different product." };
  if (buyerId && link.userId === buyerId) return { error: "You can't use your own referral link." };

  return {
    linkId: link.id,
    code: link.code,
    affiliateId: link.userId,
    affiliateName: link.user.name,
    commissionBps: link.program.commissionBps,
    productId: link.program.productId,
    productTitle: link.program.product.title,
  };
}

// Records a landing click on an affiliate link (public).
export async function recordClick(code: string, productId: string): Promise<boolean> {
  const normalized = String(code || "").trim().toLowerCase();
  if (!normalized) return false;
  const link = await db.affiliateLink.findUnique({
    where: { code: normalized },
    include: { program: true },
  });
  if (!link || !link.active || !link.program.active) return false;
  if (link.program.productId !== productId) return false;
  await db.affiliateLink.update({
    where: { id: link.id },
    data: { clicks: { increment: 1 } },
  });
  return true;
}

// Mints a PENDING commission for a referred first invoice. Called from the
// checkout pipeline (and the trial-conversion path) once payment succeeds.
export async function createReferralCommission(opts: {
  refLinkId: string;
  subscriptionId: string;
  invoiceAmountCents: number;
}): Promise<{ amountCents: number; code: string } | null> {
  const link = await db.affiliateLink.findUnique({
    where: { id: opts.refLinkId },
    include: { program: { include: { product: true } }, user: true },
  });
  if (!link || !link.active || !link.program.active) return null;

  const amountCents = Math.round((opts.invoiceAmountCents * link.program.commissionBps) / 10000);
  if (amountCents <= 0) return null;

  // Idempotency: one commission per subscription.
  const dupe = await db.affiliateCommission.findFirst({
    where: { subscriptionId: opts.subscriptionId },
  });
  if (dupe) return null;

  await db.affiliateCommission.create({
    data: {
      linkId: link.id,
      affiliateId: link.userId,
      creatorId: link.program.creatorId,
      productId: link.program.productId,
      subscriptionId: opts.subscriptionId,
      amountCents,
    },
  });
  await db.affiliateLink.update({
    where: { id: link.id },
    data: { conversions: { increment: 1 } },
  });
  await notify({
    userId: link.userId,
    type: "affiliate_earned",
    title: `Referral commission — ${(amountCents / 100).toFixed(2)} pending`,
    body: `Someone joined ${link.program.product.title} through your link ${link.code}. It settles on the next billing run.`,
    icon: "tag",
  });
  return { amountCents, code: link.code };
}

// Settles every PENDING commission (billing-run cadence). Returns the count.
export async function settlePendingCommissions(now: Date): Promise<number> {
  const pending = await db.affiliateCommission.findMany({
    where: { status: "PENDING" },
    include: { link: { include: { program: { include: { product: true } } } } },
  });
  for (const c of pending) {
    await db.affiliateCommission.update({
      where: { id: c.id },
      data: { status: "PAID", paidAt: now },
    });
    await notify({
      userId: c.affiliateId,
      type: "affiliate_paid",
      title: `Referral payout — $${(c.amountCents / 100).toFixed(2)}`,
      body: `Your commission for ${c.link.program.product.title} landed in your balance.`,
      icon: "bank",
    });
  }
  return pending.length;
}
