import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import type { WhopIngestionEventDTO } from "@/lib/types";

// GET /api/webhooks/whop/events — Whop → Vendly ingestion feed for the
// creator studio (Webhooks tab). Surfaces every ACCEPTED Whop webhook event
// (WhopEvent rows) with its reconciliation outcome:
//   reconciled  — matched a local invoice and updated it
//   noop        — matched but already in the right state
//   unmatched   — no local invoice for the payment ref (needs review /
//                 re-reconcile once the record lands)
//   no-rule     — event type recorded, no reconciliation rule
//   error       — reconciliation threw (retryable via re-reconcile)
//
// Scoping (demo platform policy):
//   • Events whose payment ref maps to an invoice on YOUR products → full
//     detail (invoice number, product, outcome, payload).
//   • UNMATCHED events carry no invoice by definition, so they are not
//     attributable to any creator — they are platform-level "needs review"
//     rows. They are listed (type + payment ref + outcome only; the raw
//     payload stays hidden) because reconciling them is exactly the manual
//     review workflow this surface exists for.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const rows = await db.whopEvent.findMany({ orderBy: { at: "desc" }, take: 120 });

    // Map payment refs (data.id) → invoices on this creator's products.
    const paymentIds: string[] = [];
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.payload || "{}") as { data?: { id?: unknown } };
        if (typeof parsed.data?.id === "string" && parsed.data.id) paymentIds.push(parsed.data.id);
      } catch {
        // malformed payload → surfaced as its own no-rule row
      }
    }
    const invoices = paymentIds.length
      ? await db.invoice.findMany({
          where: { whopRef: { in: paymentIds } },
          select: {
            id: true,
            number: true,
            whopRef: true,
            amountCents: true,
            status: true,
            productId: true,
            subscription: { select: { plan: { select: { productId: true } } } },
            user: { select: { name: true, email: true } },
          },
        })
      : [];
    const owned = await db.product.findMany({
      where: { creatorId: user.id },
      select: { id: true, title: true },
    });
    const ownedIds = new Set(owned.map((p) => p.id));
    const invoiceByRef = new Map(invoices.map((i) => [i.whopRef as string, i]));

    const events: WhopIngestionEventDTO[] = [];
    for (const r of rows) {
      let paymentId: string | null = null;
      let amountCents: number | null = null;
      try {
        const parsed = JSON.parse(r.payload || "{}") as {
          data?: { id?: unknown; amount?: { amount?: unknown }; refunded_amount?: { amount?: unknown } };
        };
        const data = (parsed.data as Record<string, unknown>) ?? {};
        if (typeof data.id === "string") paymentId = data.id;
        const money = data.amount ?? data.refunded_amount;
        const amt = (money as { amount?: unknown } | undefined)?.amount;
        if (typeof amt === "string" || typeof amt === "number") {
          amountCents = Math.round(Number(amt) * 100);
        }
      } catch {
        // payload stays hidden
      }
      const inv = paymentId ? invoiceByRef.get(paymentId) : undefined;
      const productId = inv?.productId ?? inv?.subscription?.plan.productId ?? null;
      const isMine = productId != null && ownedIds.has(productId);
      if (!isMine && r.outcome !== "unmatched") continue; // other creators' money events

      events.push({
        id: r.id,
        eventId: r.eventId,
        type: r.type,
        at: r.at.toISOString(),
        outcome: r.outcome as WhopIngestionEventDTO["outcome"],
        outcomeDetail: r.outcomeDetail,
        paymentId,
        amountCents,
        // Scope discipline: unmatched platform rows expose refs + outcome
        // only — the raw payload could reference any seller's customer.
        payloadVisible: isMine,
        payload: isMine ? r.payload : null,
        invoiceNumber: isMine ? (inv?.number ?? null) : null,
        invoiceStatus: isMine ? (inv?.status ?? null) : null,
        productTitle:
          (isMine && productId ? owned.find((p) => p.id === productId)?.title : null) ?? null,
        buyer: isMine && inv?.user ? { name: inv.user.name, email: inv.user.email } : null,
      });
    }

    return Response.json({ events, now: (await getNow()).toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
