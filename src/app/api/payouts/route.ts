import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { creatorBalance, PLATFORM_FEE_BPS } from "@/lib/payouts";
import { notify } from "@/lib/notifications";
import type { PayoutDTO } from "@/lib/types";

// GET /api/payouts — creator balance + payout history
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const balance = await creatorBalance(user.id);
    const payouts = await db.payout.findMany({
      where: { creatorId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const data: PayoutDTO[] = payouts.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      status: p.status as "PENDING" | "PAID",
      method: p.method,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    }));
    return Response.json({
      balance: { ...balance, feeBps: PLATFORM_FEE_BPS },
      payouts: data,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/payouts {amountCents?, method?: BANK|PAYPAL|CRYPTO} — request a withdrawal.
// Withdrawals start PENDING and settle the next time the billing engine runs.
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const method = ["BANK", "PAYPAL", "CRYPTO"].includes(String(body.method))
      ? String(body.method)
      : "BANK";

    const balance = await creatorBalance(user.id);
    let amountCents = Math.round(Number(body.amountCents) || 0);
    if (amountCents <= 0) amountCents = balance.availableCents; // withdraw everything
    if (amountCents < 500) throw new HttpError(400, "Minimum withdrawal is $5.00.");
    if (amountCents > balance.availableCents) {
      throw new HttpError(400, "That's more than your available balance.");
    }

    // The fee attributed to this payout period (not re-charged — informational)
    const feeCents = Math.round((amountCents * PLATFORM_FEE_BPS) / (10000 - PLATFORM_FEE_BPS));

    const payout = await db.payout.create({
      data: { creatorId: user.id, amountCents, feeCents, method, status: "PENDING" },
    });
    await notify({
      userId: user.id,
      type: "payout_pending",
      title: `Withdrawal of $${(amountCents / 100).toFixed(2)} requested`,
      body: `Settling via ${method === "BANK" ? "bank transfer" : method === "PAYPAL" ? "PayPal" : "on-chain transfer"} — it settles the next time the billing engine runs.`,
      icon: "bank",
    });

    return Response.json(
      {
        payout: {
          id: payout.id,
          amountCents: payout.amountCents,
          feeCents: payout.feeCents,
          status: payout.status,
          method: payout.method,
          createdAt: payout.createdAt.toISOString(),
          paidAt: null,
        },
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
