import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";

// ============ Creator payouts ============
// Whop-style economics: the platform withholds a 3% fee on every paid invoice.
// Creators withdraw their available balance; withdrawals start as PENDING and
// settle the next time the billing engine runs (i.e. when the time machine
// advances) — mirroring real payout settlement windows.

export const PLATFORM_FEE_BPS = 300; // 3%

export interface PayoutBalance {
  grossRevenueCents: number;
  platformFeeCents: number;
  availableCents: number;
  pendingCents: number;
  lifetimePaidCents: number;
}

export async function creatorBalance(creatorId: string): Promise<PayoutBalance> {
  const products = await db.product.findMany({ where: { creatorId }, select: { id: true } });
  const productIds = products.map((p) => p.id);

  const agg = await db.invoice.aggregate({
    where: { productId: { in: productIds }, status: "PAID" },
    _sum: { amountCents: true },
  });
  const grossRevenueCents = agg._sum.amountCents ?? 0;
  const platformFeeCents = Math.round((grossRevenueCents * PLATFORM_FEE_BPS) / 10000);

  const payouts = await db.payout.findMany({ where: { creatorId } });
  const lifetimePaidCents = payouts
    .filter((p) => p.status === "PAID")
    .reduce((sum, p) => sum + p.amountCents, 0);
  const pendingCents = payouts
    .filter((p) => p.status === "PENDING")
    .reduce((sum, p) => sum + p.amountCents, 0);

  const availableCents = Math.max(
    0,
    grossRevenueCents - platformFeeCents - lifetimePaidCents - pendingCents
  );

  return { grossRevenueCents, platformFeeCents, availableCents, pendingCents, lifetimePaidCents };
}

// Settles every PENDING payout for every creator. Called from the billing run
// so the time machine visibly completes the payout lifecycle.
export async function settlePendingPayouts(now: Date): Promise<number> {
  const pending = await db.payout.findMany({ where: { status: "PENDING" } });
  for (const p of pending) {
    await db.payout.update({
      where: { id: p.id },
      data: { status: "PAID", paidAt: now },
    });
    await notify({
      userId: p.creatorId,
      type: "payout_paid",
      title: `Payout of $${(p.amountCents / 100).toFixed(2)} sent`,
      body: `${p.method === "BANK" ? "Bank transfer" : p.method === "PAYPAL" ? "PayPal transfer" : "On-chain transfer"} completed after the settlement window.`,
      icon: "bank",
    });
  }
  return pending.length;
}
