import { db } from "@/lib/db";
import { getNow } from "@/lib/clock";
import type { AnalyticsDTO } from "@/lib/types";

// Creator analytics: MRR, churn, ARPU, revenue/subscriber time series.

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function computeCreatorAnalytics(creatorId: string): Promise<AnalyticsDTO> {
  const now = await getNow();
  const nowMs = now.getTime();
  const dayMs = 86400000;

  const products = await db.product.findMany({ where: { creatorId } });
  const productIds = products.map((p) => p.id);

  const [subs, invoices] = await Promise.all([
    db.subscription.findMany({
      where: { productId: { in: productIds } },
      include: { plan: true, user: true },
    }),
    db.invoice.findMany({
      where: { productId: { in: productIds }, status: "PAID" },
      orderBy: { paidAt: "asc" },
    }),
  ]);

  const activeSubs = subs.filter((s) => s.status === "ACTIVE");
  const trialing = subs.filter((s) => s.status === "TRIALING");
  const pastDue = subs.filter((s) => s.status === "PAST_DUE");

  // MRR: normalize every active sub to a monthly amount
  const mrrCents = activeSubs.reduce((sum, s) => {
    return sum + (s.plan.interval === "year" ? Math.round(s.plan.priceCents / 12) : s.plan.priceCents);
  }, 0);

  const canceled30d = subs.filter(
    (s) => s.canceledAt && nowMs - s.canceledAt.getTime() <= 30 * dayMs
  ).length;
  const churnRate = activeSubs.length + canceled30d > 0 ? canceled30d / (activeSubs.length + canceled30d) : 0;

  const totalRevenueCents = invoices.reduce((sum, i) => sum + i.amountCents, 0);
  const revenue30dCents = invoices
    .filter((i) => i.paidAt && nowMs - i.paidAt.getTime() <= 30 * dayMs)
    .reduce((sum, i) => sum + i.amountCents, 0);

  const uniquePayers = new Set(invoices.map((i) => i.userId)).size || 1;
  const avgRevenuePerUserCents = Math.round(totalRevenueCents / uniquePayers);

  // 90-day series
  const subscriberSeries: AnalyticsDTO["subscriberSeries"] = [];
  const revenueSeries: AnalyticsDTO["revenueSeries"] = [];
  const mrrSeries: AnalyticsDTO["mrrSeries"] = [];

  for (let i = 89; i >= 0; i--) {
    const dayStart = new Date(nowMs - i * dayMs);
    const dayEnd = new Date(dayStart.getTime() + dayMs);
    const key = dayKey(dayStart);

    const createdOnDay = subs.filter(
      (s) => s.createdAt >= dayStart && s.createdAt < dayEnd
    ).length;
    const canceledOnDay = subs.filter(
      (s) => s.canceledAt && s.canceledAt >= dayStart && s.canceledAt < dayEnd
    ).length;
    // active snapshot at end of that day
    const activeAtEnd = subs.filter(
      (s) => s.createdAt < dayEnd && (!s.canceledAt || s.canceledAt >= dayEnd)
    ).length;

    subscriberSeries.push({ date: key, active: activeAtEnd, new: createdOnDay, canceled: canceledOnDay });

    const invoicesOnDay = invoices.filter(
      (iv) => iv.paidAt && iv.paidAt >= dayStart && iv.paidAt < dayEnd
    );
    revenueSeries.push({
      date: key,
      revenue: invoicesOnDay.reduce((s, iv) => s + iv.amountCents, 0) / 100,
      count: invoicesOnDay.length,
    });

    // MRR snapshot at end of day (subs active at that point)
    const mrrAtEnd = subs
      .filter((s) => s.createdAt < dayEnd && (!s.canceledAt || s.canceledAt >= dayEnd))
      .reduce((sum, s) => sum + (s.plan.interval === "year" ? Math.round(s.plan.priceCents / 12) : s.plan.priceCents), 0);
    mrrSeries.push({ date: key, mrr: mrrAtEnd / 100 });
  }

  // Top products by MRR
  const topProducts = products
    .map((p) => {
      const pSubs = activeSubs.filter((s) => s.productId === p.id);
      const pMrr = pSubs.reduce(
        (sum, s) => sum + (s.plan.interval === "year" ? Math.round(s.plan.priceCents / 12) : s.plan.priceCents),
        0
      );
      const pRevenue = invoices.filter((i) => i.productId === p.id).reduce((s, i) => s + i.amountCents, 0);
      return { id: p.id, title: p.title, coverTheme: p.coverTheme, members: p.membersCount, mrrCents: pMrr, revenueCents: pRevenue };
    })
    .sort((a, b) => b.mrrCents - a.mrrCents);

  // Gateway breakdown
  const gatewayMap = new Map<string, { count: number; revenueCents: number }>();
  for (const s of subs) {
    const g = gatewayMap.get(s.gateway) || { count: 0, revenueCents: 0 };
    g.count++;
    gatewayMap.set(s.gateway, g);
  }
  for (const inv of invoices) {
    if (!inv.gateway) continue;
    const g = gatewayMap.get(inv.gateway) || { count: 0, revenueCents: 0 };
    g.revenueCents += inv.amountCents;
    gatewayMap.set(inv.gateway, g);
  }
  const gatewayBreakdown = Array.from(gatewayMap.entries()).map(([gateway, v]) => ({ gateway, ...v }));

  // Recent activity feed (last 12 events across invoices + subs)
  const recentActivity: AnalyticsDTO["recentActivity"] = [];
  const recentInvoices = await db.invoice.findMany({
    where: { productId: { in: productIds } },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { user: true },
  });
  for (const inv of recentInvoices) {
    recentActivity.push({
      id: inv.id,
      type: inv.status === "PAID" ? "invoice.paid" : inv.status === "FAILED" ? "invoice.failed" : "invoice",
      message:
        inv.status === "PAID"
          ? `${inv.user?.name || inv.user?.email} paid ${inv.description}`
          : `Payment failed for ${inv.description}`,
      amountCents: inv.amountCents,
      at: inv.createdAt.toISOString(),
    });
  }
  const recentSubs = await db.subscription.findMany({
    where: { productId: { in: productIds } },
    orderBy: { createdAt: "desc" },
    take: 6,
    include: { user: true, plan: true },
  });
  for (const s of recentSubs) {
    recentActivity.push({
      id: s.id,
      type: "subscription.created",
      message: `${s.user?.name || s.user?.email} subscribed to ${s.plan.name}`,
      amountCents: s.plan.priceCents,
      at: s.createdAt.toISOString(),
    });
  }
  recentActivity.sort((a, b) => b.at.localeCompare(a.at));

  return {
    mrrCents,
    arrCents: mrrCents * 12,
    activeSubscriptions: activeSubs.length,
    trialingCount: trialing.length,
    pastDueCount: pastDue.length,
    canceled30d,
    churnRate,
    totalRevenueCents,
    revenue30dCents,
    avgRevenuePerUserCents,
    subscriberSeries,
    revenueSeries,
    mrrSeries,
    topProducts,
    gatewayBreakdown,
    recentActivity: recentActivity.slice(0, 12),
  };
}
