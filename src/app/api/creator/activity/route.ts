import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { fmtMoney } from "@/lib/format";
import type { ActivityDTO } from "@/lib/types";

// GET /api/creator/activity?limit=50 — a merged, newest-first timeline of
// everything happening across the creator's products: new subscribers, failed
// payments, reviews, questions (+ the creator's own answers), giveaway
// entries, bundle sales and payouts. Purely read-only aggregation.
//
// Double-counting guard: bundle-origin subscriptions (bundleTitle snapshot
// set) are skipped here — the BundlePurchase row already emits one
// "bundle_sold" event for the whole purchase.

const GATEWAY_LABELS: Record<string, string> = {
  WHOP: "Card · Whop",
  STRIPE: "Card · Stripe",
  PAYPAL: "PayPal",
  CRYPTO: "Crypto",
};

/** Clip a free-text snippet for the timeline body (spec: first 90 chars). */
function clip(s: string, max = 90): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const parsed = Number.parseInt(url.searchParams.get("limit") || "50", 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;

    const ownedProducts = await db.product.findMany({
      where: { creatorId: user.id },
      select: { id: true },
    });
    const productIds = ownedProducts.map((p) => p.id);
    if (productIds.length === 0) return Response.json({ activities: [] });

    // Invoice only carries a scalar productId (no relation) — map id → title.
    const productTitles = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true },
    });
    const titleById = new Map(productTitles.map((p) => [p.id, p.title]));

    const [subscriptions, failedInvoices, reviews, questions, answers, giveawayEntries, bundlePurchases, payouts] =
      await Promise.all([
        // New subscribers — bundle-origin subs excluded (see note above).
        db.subscription.findMany({
          where: { productId: { in: productIds }, bundleTitle: null },
          include: { plan: true, product: { select: { id: true, title: true } } },
        }),
        // Failed charges (dunning).
        db.invoice.findMany({
          where: { status: "FAILED", productId: { in: productIds } },
        }),
        // Reviews across the creator's products.
        db.review.findMany({
          where: { productId: { in: productIds } },
          include: { product: { select: { id: true, title: true } } },
        }),
        // Buyer questions.
        db.question.findMany({
          where: { productId: { in: productIds } },
          include: { product: { select: { id: true, title: true } } },
        }),
        // The creator's own answers (scoped to their products via the question).
        db.answer.findMany({
          where: { authorId: user.id, question: { product: { creatorId: user.id } } },
          include: { question: { include: { product: { select: { id: true, title: true } } } } },
        }),
        // Entries into the creator's giveaways.
        db.giveawayEntry.findMany({
          where: { giveaway: { creatorId: user.id } },
          include: {
            user: { select: { name: true, email: true } },
            giveaway: { include: { product: { select: { id: true, title: true } } } },
          },
        }),
        // Bundle sales (one event per purchase).
        db.bundlePurchase.findMany({
          where: { bundle: { creatorId: user.id } },
          include: {
            user: { select: { name: true, email: true } },
            bundle: { include: { items: true } },
          },
        }),
        // Payouts to the creator.
        db.payout.findMany({ where: { creatorId: user.id } }),
      ]);

    const activities: ActivityDTO[] = [
      ...subscriptions.map((s): ActivityDTO => ({
        id: `sub-${s.id}`,
        type: "subscriber_new",
        title: `New subscriber — ${s.product.title}`,
        body: `${s.plan.name} · ${GATEWAY_LABELS[s.gateway] || s.gateway} · ${fmtMoney(s.plan.priceCents)}/${s.plan.interval === "year" ? "yr" : "mo"}`,
        at: s.createdAt.toISOString(),
        productId: s.product.id,
        productTitle: s.product.title,
      })),
      ...failedInvoices.map((i): ActivityDTO => ({
        id: `inv-${i.id}`,
        type: "payment_failed",
        title: `Payment failed — ${titleById.get(i.productId || "") || "your product"}`,
        body: `${clip(i.description)} · retrying`,
        at: i.createdAt.toISOString(),
        productId: i.productId,
        productTitle: i.productId ? titleById.get(i.productId) ?? null : null,
      })),
      ...reviews.map((r): ActivityDTO => ({
        id: `rev-${r.id}`,
        type: "review_new",
        title: `New ${r.rating}★ review — ${r.product.title}`,
        body: clip(r.comment),
        at: r.createdAt.toISOString(),
        productId: r.product.id,
        productTitle: r.product.title,
      })),
      ...questions.map((q): ActivityDTO => ({
        id: `que-${q.id}`,
        type: "question_new",
        title: `New question — ${q.product.title}`,
        body: clip(q.body),
        at: q.createdAt.toISOString(),
        productId: q.product.id,
        productTitle: q.product.title,
        questionId: q.id,
      })),
      ...answers.map((a): ActivityDTO => ({
        id: `ans-${a.id}`,
        type: "question_answered",
        title: `You answered — ${a.question.product.title}`,
        body: clip(a.question.body),
        at: a.createdAt.toISOString(),
        productId: a.question.product.id,
        productTitle: a.question.product.title,
        questionId: a.question.id,
      })),
      ...giveawayEntries.map((ge): ActivityDTO => ({
        id: `entry-${ge.id}`,
        type: "giveaway_entry",
        title: `New entry — ${ge.giveaway.title}`,
        body: `${ge.user.name || ge.user.email} entered`,
        at: ge.createdAt.toISOString(),
        productId: ge.giveaway.productId,
        productTitle: ge.giveaway.product?.title ?? null,
      })),
      ...bundlePurchases.map((bp): ActivityDTO => ({
        id: `bundle-${bp.id}`,
        type: "bundle_sold",
        title: `Bundle sold — ${bp.bundle.title}`,
        body: `${bp.user.name || bp.user.email} · ${bp.bundle.items.length} products · ${fmtMoney(bp.totalCents)}`,
        at: bp.createdAt.toISOString(),
        productId: null,
        productTitle: null,
      })),
      ...payouts.map((p): ActivityDTO => ({
        id: `payout-${p.id}`,
        type: "payout",
        title: `Payout ${p.status.toLowerCase()} — ${fmtMoney(p.amountCents)}`,
        body: null,
        at: (p.paidAt ?? p.createdAt).toISOString(),
        productId: null,
        productTitle: null,
      })),
    ];

    activities.sort((a, b) => b.at.localeCompare(a.at));
    return Response.json({ activities: activities.slice(0, limit) });
  } catch (e) {
    return errorResponse(e);
  }
}
