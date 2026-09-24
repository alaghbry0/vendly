import { db } from "@/lib/db";
import { HttpError } from "@/lib/session";
import { provisionSubscription, type ProvisionResult } from "@/lib/billing";
import { notify } from "@/lib/notifications";
import type { Bundle, BundleItem, Plan, Product, User, BundlePurchase } from "@prisma/client";
import type { BundleDTO, BundleItemDTO } from "@/lib/types";

// ============ Bundle offers ============
// Creators bundle 2–6 of their own products at a discountPct off each
// included plan; buyers purchase every product in one checkout. The bundle
// origin is snapshotted onto each subscription (bundleId/bundleTitle/
// bundleDiscountPct) so renewals keep charging the discounted price even if
// the bundle is later deactivated or deleted.

export function bundleSlugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bundle";
}

export type BundleWithRelations = Bundle & {
  creator: Pick<User, "id" | "name">;
  items: (BundleItem & { plan: Plan; product: Product })[];
};

export interface LoadedBundleItem {
  item: BundleItem;
  plan: Plan;
  product: Product;
}

export interface LoadedBundle {
  bundle: Bundle;
  items: LoadedBundleItem[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  interval: string;
}

// Prisma include that hydrates a bundle for serialization / checkout.
// (Items are sorted by sortOrder in JS — keeps the include object simple.)
export const BUNDLE_INCLUDE = {
  creator: { select: { id: true, name: true } },
  items: { include: { plan: true, product: true } },
} as const;

// Per-item discounted price (rounded cents).
export function bundleItemDiscountedCents(priceCents: number, discountPct: number): number {
  return Math.round((priceCents * (100 - discountPct)) / 100);
}

// Loads a bundle with items→plan→product and validates it end-to-end for a
// checkout: active bundle, active products/plans, ≥2 items, shared interval.
export async function loadBundleForCheckout(bundleId: string): Promise<LoadedBundle> {
  const bundle = await db.bundle.findUnique({
    where: { id: bundleId },
    include: BUNDLE_INCLUDE,
  });
  if (!bundle) throw new HttpError(404, "Bundle not found.");
  if (!bundle.active) throw new HttpError(400, "This bundle is no longer available.");
  if (bundle.items.length < 2) throw new HttpError(400, "This bundle is incomplete.");

  const items: LoadedBundleItem[] = [];
  let subtotalCents = 0;
  let discountedTotal = 0;
  let interval: string | null = null;
  for (const row of [...bundle.items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (row.product.status !== "ACTIVE" || !row.plan.active) {
      throw new HttpError(400, `${row.product.title} is not accepting new members right now.`);
    }
    if (interval === null) interval = row.plan.interval;
    else if (row.plan.interval !== interval) {
      throw new HttpError(400, "All plans in a bundle must share the same billing interval.");
    }
    subtotalCents += row.plan.priceCents;
    discountedTotal += bundleItemDiscountedCents(row.plan.priceCents, bundle.discountPct);
    items.push({ item: row, plan: row.plan, product: row.product });
  }

  return {
    bundle,
    items,
    subtotalCents,
    discountCents: subtotalCents - discountedTotal,
    totalCents: discountedTotal,
    interval: interval ?? "month",
  };
}

// Duplicate-subscription guard: a buyer with any live sub on an included
// product must manage it from their portal before buying the bundle. Called
// BEFORE charging in every bundle checkout flow.
export async function assertBundlePurchasable(userId: string, loaded: LoadedBundle): Promise<void> {
  for (const { product } of loaded.items) {
    const existing = await db.subscription.findFirst({
      where: {
        userId,
        productId: product.id,
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "PENDING"] },
      },
    });
    if (existing) {
      throw new HttpError(
        409,
        `You already have a subscription to ${product.title} — manage it from your portal before buying the bundle.`
      );
    }
  }
}

// Serializes a bundle (with items+plans+products) into a BundleDTO. Stats
// default to 0 — the creator route computes real numbers.
export function serializeBundle(
  b: BundleWithRelations,
  stats?: { salesCount: number; revenueCents: number; membersCount: number }
): BundleDTO {
  const items: BundleItemDTO[] = [...b.items]
    .sort((a, c) => a.sortOrder - c.sortOrder)
    .map((row) => ({
      productId: row.product.id,
      productTitle: row.product.title,
      productSlug: row.product.slug,
      coverTheme: row.product.coverTheme,
      category: row.product.category,
      planId: row.plan.id,
      planName: row.plan.name,
      priceCents: row.plan.priceCents,
      discountedCents: bundleItemDiscountedCents(row.plan.priceCents, b.discountPct),
      interval: row.plan.interval,
    }));
  const subtotalCents = items.reduce((s, i) => s + i.priceCents, 0);
  const totalCents = items.reduce((s, i) => s + i.discountedCents, 0);
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    description: b.description,
    discountPct: b.discountPct,
    coverTheme: b.coverTheme,
    active: b.active,
    creatorId: b.creatorId,
    creatorName: b.creator.name,
    createdAt: b.createdAt.toISOString(),
    items,
    subtotalCents,
    discountCents: subtotalCents - totalCents,
    totalCents,
    salesCount: stats?.salesCount ?? 0,
    revenueCents: stats?.revenueCents ?? 0,
    membersCount: stats?.membersCount ?? 0,
  };
}

// Provisions every included product's subscription (discounted first charge,
// bundle snapshot on each sub) + the single BundlePurchase row + both
// notifications. Assumes payment already succeeded.
export async function provisionBundle(opts: {
  userId: string;
  loaded: LoadedBundle;
  gateway: "STRIPE" | "PAYPAL" | "WHOP";
  paymentMethodId: string | null;
  txnId?: string;
  whopRef?: string | null;
}): Promise<{ purchase: BundlePurchase; results: ProvisionResult[] }> {
  const { loaded } = opts;
  const bundle = loaded.bundle;

  // guard: no live sub on any included product
  await assertBundlePurchasable(opts.userId, loaded);

  const results: ProvisionResult[] = [];
  for (const { plan } of loaded.items) {
    results.push(
      await provisionSubscription({
        userId: opts.userId,
        planId: plan.id,
        gateway: opts.gateway,
        paymentMethodId: opts.paymentMethodId,
        chargedNow: true,
        txnId: opts.txnId,
        bundle: { id: bundle.id, title: bundle.title, discountPct: bundle.discountPct },
      })
    );
  }

  const purchase = await db.bundlePurchase.create({
    data: {
      bundleId: bundle.id,
      userId: opts.userId,
      subtotalCents: loaded.subtotalCents,
      discountCents: loaded.discountCents,
      totalCents: loaded.totalCents,
      gateway: opts.gateway,
      whopRef: opts.whopRef ?? null,
    },
  });

  const buyer = await db.user.findUnique({ where: { id: opts.userId } });
  const buyerName = buyer?.name || buyer?.email || "A member";
  const n = loaded.items.length;
  await notify({
    userId: bundle.creatorId,
    type: "bundle_sold",
    title: `Bundle sold — ${bundle.title}`,
    body: `${buyerName} · ${n} products · $${(loaded.totalCents / 100).toFixed(2)} · save ${bundle.discountPct}%`,
    icon: "gift",
  });
  await notify({
    userId: opts.userId,
    type: "bundle_purchased",
    title: `Bundle purchased — ${bundle.title}`,
    body: `You now have access to ${n} products — manage them from My Hub → Memberships.`,
    icon: "gift",
  });

  return { purchase, results };
}

// Receipt line items for a completed bundle checkout — one row per included
// product, zipped with its provision result (same order as loaded.items).
export function bundleReceiptItems(loaded: LoadedBundle, results: ProvisionResult[]) {
  return loaded.items.map((entry, i) => ({
    productTitle: entry.product.title,
    planName: entry.plan.name,
    subscriptionId: results[i]?.subscriptionId ?? "",
    invoiceId: results[i]?.invoiceId ?? "",
    licenseKeyId: results[i]?.licenseKeyId ?? null,
    amountCents: bundleItemDiscountedCents(entry.plan.priceCents, loaded.bundle.discountPct),
    interval: entry.plan.interval,
  }));
}
