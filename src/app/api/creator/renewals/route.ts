import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";

// GET /api/creator/renewals?days=14 — upcoming-renewal forecast for the
// creator's products, grouped by platform-clock day.
//
// Renewal moment = currentPeriodEnd (for TRIALING subs this is the trial end,
// i.e. the conversion charge). Amounts are the EXPECTED charge: the plan price
// with the subscription's persistent bundle discount applied (recurring promos
// and goodwill adjustments are not predictable far out, so they are excluded).
//
// Also returns `overdue` — subs currently in dunning (PAST_DUE) whose period
// already ended: revenue at risk RIGHT NOW rather than in the window.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 14));

    const products = await db.product.findMany({ where: { creatorId: user.id }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    if (productIds.length === 0) {
      return Response.json({ now: (await getNow()).toISOString(), days, groups: [], totalCents: 0, overdue: { count: 0, amountCents: 0 } });
    }

    const now = await getNow();
    const horizon = new Date(now.getTime() + days * 86400000);

    const [upcoming, overdueSubs] = await Promise.all([
      db.subscription.findMany({
        where: {
          productId: { in: productIds },
          status: { in: ["ACTIVE", "TRIALING"] },
          cancelAtPeriodEnd: false,
          currentPeriodEnd: { gte: now, lte: horizon },
        },
        include: { plan: { include: { product: true } } },
        orderBy: { currentPeriodEnd: "asc" },
      }),
      db.subscription.findMany({
        where: {
          productId: { in: productIds },
          status: "PAST_DUE",
          cancelAtPeriodEnd: false,
        },
        include: { plan: true },
      }),
    ]);

    // Expected renewal charge for a sub (bundle discount is persistent).
    const expectedCents = (s: { plan: { priceCents: number }; bundleDiscountPct: number | null }) =>
      s.bundleDiscountPct
        ? Math.round((s.plan.priceCents * (100 - s.bundleDiscountPct)) / 100)
        : s.plan.priceCents;

    // Group by platform-clock day → product+plan+status line.
    const byDay = new Map<
      string,
      Map<string, { productId: string; productTitle: string; coverTheme: string; planName: string; interval: string; status: string; count: number; amountCents: number }>
    >();
    for (const s of upcoming) {
      const dayKey = s.currentPeriodEnd.toISOString().slice(0, 10);
      let day = byDay.get(dayKey);
      if (!day) {
        day = new Map();
        byDay.set(dayKey, day);
      }
      const lineKey = `${s.productId}|${s.planId}|${s.status}`;
      const existing = day.get(lineKey);
      const amt = expectedCents(s);
      if (existing) {
        existing.count += 1;
        existing.amountCents += amt;
      } else {
        day.set(lineKey, {
          productId: s.productId,
          productTitle: s.plan.product.title,
          coverTheme: s.plan.product.coverTheme,
          planName: s.plan.name,
          interval: s.plan.interval,
          status: s.status,
          count: 1,
          amountCents: amt,
        });
      }
    }

    const groups = [...byDay.entries()]
      .map(([date, items]) => ({
        date,
        amountCents: [...items.values()].reduce((sum, i) => sum + i.amountCents, 0),
        items: [...items.values()],
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalCents = groups.reduce((sum, g) => sum + g.amountCents, 0);
    const overdue = {
      count: overdueSubs.length,
      amountCents: overdueSubs.reduce((sum, s) => sum + expectedCents(s), 0),
    };

    return Response.json({ now: now.toISOString(), days, groups, totalCents, overdue });
  } catch (e) {
    return errorResponse(e);
  }
}
