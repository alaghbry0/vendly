import { db } from "@/lib/db";
import type { AuditEventDTO } from "@/lib/types";

// ============ Creator-scoped audit trail fetch (shared) ============
//
// One scoping implementation for both the read route (GET /api/creator/audit)
// and the CSV export (GET /api/creator/audit/export), so the file a creator
// downloads can never diverge from what the UI shows.
//
// Scope: events on invoices/subscriptions whose product belongs to the
// creator, PLUS events the creator initiated themselves. Date filters are
// platform-clock ISO strings (inclusive bounds; `to` is inclusive by adding
// 1 day internally when only a date is given — callers pass full ISO
// timestamps).

export interface ScopedAuditOptions {
  from?: Date | null; // inclusive lower bound on `at`
  to?: Date | null; // inclusive upper bound on `at`
  action?: string | null;
  q?: string | null;
  take?: number;
  /** Pagination: skip the first N scoped events (UI "load more"). */
  skip?: number;
}

export interface ScopedAuditPage {
  events: AuditEventDTO[];
  /** True when more scoped events exist beyond this page (within the scan
   *  window) — drives the UI's "Load more" button. */
  hasMore: boolean;
  /** Raw AuditLog rows examined to build this page (observability). */
  scanned: number;
}

// Raw rows pulled per query. Must comfortably exceed the export take (2000)
// so CSV exports stay complete; also caps how deep UI pagination can page.
const AUDIT_SCAN_WINDOW = 2500;

export async function scopedAuditEvents(userId: string, opts: ScopedAuditOptions = {}): Promise<ScopedAuditPage> {
  const take = Math.min(2000, Math.max(1, opts.take ?? 200));
  const skip = Math.min(2000, Math.max(0, opts.skip ?? 0));
  const q = (opts.q || "").trim().toLowerCase();

  const owned = await db.product.findMany({ where: { creatorId: userId }, select: { id: true } });
  const ownedIds = new Set(owned.map((p) => p.id));

  const rows = await db.auditLog.findMany({
    where: {
      AND: [
        {
          OR: [
            { invoiceId: { not: null } },
            { subscriptionId: { not: null } },
            { actorId: userId },
          ],
        },
        ...(opts.from ? [{ at: { gte: opts.from } }] : []),
        ...(opts.to ? [{ at: { lte: opts.to } }] : []),
        ...(opts.action ? [{ action: opts.action }] : []),
      ],
    },
    orderBy: { at: "desc" },
    take: AUDIT_SCAN_WINDOW, // scan window; precise scoping happens below
  });

  // Resolve ownership for the join keys we actually saw.
  const invoiceIds = [...new Set(rows.map((r) => r.invoiceId).filter((v): v is string => !!v))];
  const subIds = [...new Set(rows.map((r) => r.subscriptionId).filter((v): v is string => !!v))];

  const invoices = invoiceIds.length
    ? await db.invoice.findMany({
        where: { id: { in: invoiceIds } },
        select: {
          id: true,
          number: true,
          productId: true,
          userId: true,
          subscription: { select: { plan: { select: { productId: true } } } },
          user: { select: { name: true, email: true } },
        },
      })
    : [];
  const subs = subIds.length
    ? await db.subscription.findMany({
        where: { id: { in: subIds } },
        select: {
          id: true,
          userId: true,
          plan: { select: { productId: true, product: { select: { title: true } } } },
          user: { select: { name: true, email: true } },
        },
      })
    : [];
  const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
  const subMap = new Map(subs.map((s) => [s.id, s]));

  // Resolve actor display names (creators refunding, buyers acting, or
  // system identities like "worker"/"whop").
  const actorIds = [...new Set(rows.map((r) => r.actorId))];
  const actorUsers = actorIds.length
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })
    : [];
  const actorMap = new Map(actorUsers.map((u) => [u.id, u]));

  const scoped: AuditEventDTO[] = [];
  for (const r of rows) {
    const inv = r.invoiceId ? invoiceMap.get(r.invoiceId) : undefined;
    const sub = r.subscriptionId ? subMap.get(r.subscriptionId) : undefined;
    const productId = inv?.productId ?? sub?.plan.productId ?? null;
    const isMine = productId != null && ownedIds.has(productId);
    const isMyAction = r.actorId === userId;
    if (!isMine && !isMyAction) continue; // other creators' money events

    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(r.detail || "{}");
    } catch {
      detail = {};
    }

    const buyer = inv?.user ?? (sub ? { name: sub.user.name, email: sub.user.email } : null);
    const actor = actorMap.get(r.actorId);

    scoped.push({
      id: r.id,
      at: r.at.toISOString(),
      action: r.action,
      actorId: r.actorId,
      actorLabel: actorLabel(r.actorId, actor, userId),
      gateway: r.gateway,
      amountCents: r.amountCents,
      invoiceId: r.invoiceId,
      invoiceNumber: inv?.number ?? null,
      subscriptionId: r.subscriptionId,
      whopRef: r.whopRef,
      productTitle: sub?.plan.product?.title ?? (typeof detail.product === "string" ? detail.product : null),
      buyer: buyer ? { name: buyer.name, email: buyer.email } : null,
      detail,
    });
  }

  // Text search applies BEFORE pagination so every page has a stable size
  // and "load more" never skips a match.
  const matched = q
    ? scoped.filter(
        (e) =>
          (e.whopRef || "").toLowerCase().includes(q) ||
          (e.invoiceNumber || "").toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q) ||
          (e.productTitle || "").toLowerCase().includes(q) ||
          (e.actorLabel || "").toLowerCase().includes(q) ||
          (e.buyer?.email || "").toLowerCase().includes(q)
      )
    : scoped;

  const events = matched.slice(skip, skip + take);
  const hasMore = skip + take < matched.length;
  return { events, hasMore, scanned: rows.length };
}

function actorLabel(
  actorId: string,
  actor: { name: string | null; email: string | null } | undefined,
  meId: string
): string {
  if (actorId === "worker") return "Billing worker";
  if (actorId === "whop") return "Whop webhook";
  if (actorId === "system") return "System";
  if (actorId === meId) return "You";
  if (actor) return actor.name || actor.email || "Unknown user";
  return actorId.slice(0, 10);
}

// ============ CSV serialization (RFC 4180) ============

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function auditEventsToCsv(events: AuditEventDTO[]): string {
  const header = [
    "at_iso",
    "at_human",
    "action",
    "actor",
    "gateway",
    "amount_usd",
    "invoice",
    "whop_ref",
    "product",
    "buyer_name",
    "buyer_email",
    "detail",
  ];
  const lines = [header.join(",")];
  for (const e of events) {
    lines.push(
      [
        e.at,
        new Date(e.at).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z"),
        e.action,
        e.actorLabel,
        e.gateway || "",
        (e.amountCents / 100).toFixed(2),
        e.invoiceNumber || "",
        e.whopRef || "",
        e.productTitle || "",
        e.buyer?.name || "",
        e.buyer?.email || "",
        JSON.stringify(e.detail ?? {}),
      ]
        .map((c) => csvCell(String(c)))
        .join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
