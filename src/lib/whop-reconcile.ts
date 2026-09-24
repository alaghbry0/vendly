import { db } from "@/lib/db";
import { getNow } from "@/lib/clock";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { notify } from "@/lib/notifications";

// ============ Whop webhook reconciliation (shared) ============
//
// One reconciliation implementation used by BOTH the live ingestion route
// (POST /api/webhooks/whop) and the manual re-reconcile path (creator studio
// → Whop ingestion → "Re-reconcile"), so a manual pass behaves byte-for-byte
// like a redelivery.
//
// reconcileWhopEvent(type, data) → { outcome, note }
//   outcome ∈ reconciled | noop | unmatched | no-rule
//   (the CALLER maps thrown errors to outcome "error" + records the note)
//
// Reconciliation rules:
//   payment.succeeded / payment.updated(succeeded|paid)
//     • invoice found by whopRef + not PAID → flip to PAID, revive PAST_DUE
//       sub, notify buyer, audit webhook.reconciled                    → reconciled
//     • invoice found + already PAID                                    → noop
//     • no invoice                                                      → unmatched
//   payment.failed / payment.updated(failed)
//     • invoice found → audit (engine owns dunning)                    → reconciled
//     • no invoice → audit unmatched note                              → unmatched
//   payment.refunded
//     • PAID invoice → mirror cumulative refunded_amount locally       → reconciled
//     • otherwise → audit unmatched note                               → unmatched
//   anything else → recorded, no rule                                  → no-rule

export interface ReconcileOutcome {
  outcome: "reconciled" | "noop" | "unmatched" | "no-rule";
  note: string;
}

export async function reconcileWhopEvent(
  type: string,
  data: Record<string, unknown>
): Promise<ReconcileOutcome> {
  const paymentId = typeof data.id === "string" ? data.id : "";
  const substatus =
    typeof (data as { substatus?: unknown }).substatus === "string"
      ? (data as { substatus: string }).substatus
      : "";
  const status =
    typeof (data as { status?: unknown }).status === "string" ? (data as { status: string }).status : "";

  if (
    type === "payment.succeeded" ||
    (type === "payment.updated" && (substatus === "succeeded" || status === "paid"))
  ) {
    if (!paymentId) return { outcome: "no-rule", note: "event carried no payment id" };
    let invoice = await db.invoice.findFirst({ where: { whopRef: paymentId } });
    if (!invoice) {
      // Delivery-vs-checkout race: Whop can notify us BEFORE our checkout
      // transaction commits the invoice with its whopRef. One short delayed
      // re-check closes the common window without blocking long.
      await new Promise((r) => setTimeout(r, 1500));
      invoice = await db.invoice.findFirst({ where: { whopRef: paymentId } });
    }
    if (!invoice) {
      await audit({
        actorId: "whop",
        action: AUDIT_ACTIONS.webhookUnmatched,
        whopRef: paymentId,
        detail: { type, note: "no local invoice for this payment" },
      });
      return { outcome: "unmatched", note: "no local invoice for this payment" };
    }
    if (invoice.status === "PAID") {
      return { outcome: "noop", note: "invoice was already paid — nothing to flip" };
    }
    // Late settlement: the charge settled AFTER our polling window closed.
    // Mark the invoice PAID on the platform clock.
    const now = await getNow();
    await db.invoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", paidAt: now },
    });
    // If the buyer's subscription went PAST_DUE over this charge, revive it.
    if (invoice.subscriptionId) {
      const sub = await db.subscription.findUnique({ where: { id: invoice.subscriptionId } });
      if (sub && sub.status === "PAST_DUE") {
        await db.subscription.update({
          where: { id: sub.id },
          data: { status: "ACTIVE", dunningAttempts: 0, pendingWhopRef: null, pendingWhopRefAt: null },
        });
      }
      if (sub?.pendingWhopRef === paymentId) {
        await db.subscription.update({
          where: { id: sub.id },
          data: { pendingWhopRef: null, pendingWhopRefAt: null },
        });
      }
    }
    await audit({
      actorId: "whop",
      action: AUDIT_ACTIONS.webhookReconciled,
      whopRef: paymentId,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      amountCents: invoice.amountCents,
      detail: { type, note: "late settlement — invoice flipped to PAID" },
    });
    await notify({
      userId: invoice.userId,
      type: "invoice_paid",
      title: `Payment confirmed — ${invoice.number} · $${(invoice.amountCents / 100).toFixed(2)}`,
      body: "The charge settled at Whop and your invoice is now paid.",
      icon: "receipt",
      at: now,
    }).catch(() => undefined);
    return { outcome: "reconciled", note: "late settlement — invoice flipped to PAID" };
  }

  if (type === "payment.failed" || (type === "payment.updated" && substatus === "failed")) {
    if (!paymentId) return { outcome: "no-rule", note: "event carried no payment id" };
    const invoice = await db.invoice.findFirst({ where: { whopRef: paymentId } });
    await audit({
      actorId: "whop",
      action: AUDIT_ACTIONS.webhookReconciled,
      whopRef: paymentId,
      invoiceId: invoice?.id ?? null,
      detail: {
        type,
        note: invoice ? "failure event matches a local invoice (engine owns dunning)" : "unmatched failure event",
      },
    });
    return invoice
      ? { outcome: "reconciled", note: "failure recorded — dunning is engine-owned" }
      : { outcome: "unmatched", note: "no local invoice for this failed payment" };
  }

  if (type === "payment.refunded") {
    if (!paymentId) return { outcome: "no-rule", note: "event carried no payment id" };
    const invoice = await db.invoice.findFirst({ where: { whopRef: paymentId } });
    if (invoice && invoice.status === "PAID") {
      // Refund initiated from Whop's dashboard — mirror it locally. The event
      // carries the CUMULATIVE refunded_amount; a partial total keeps the
      // invoice PAID with refundedCents set, a full total completes it.
      const refundedMoney = (data as { refunded_amount?: { amount?: string } }).refunded_amount;
      const refundedTotalCents = refundedMoney?.amount
        ? Math.round(Number(refundedMoney.amount) * 100)
        : invoice.amountCents; // no amount → assume full
      const isFull = refundedTotalCents >= invoice.amountCents;
      const now = await getNow();
      await db.invoice.update({
        where: { id: invoice.id },
        data: {
          refundedCents: Math.min(refundedTotalCents, invoice.amountCents),
          ...(isFull ? { status: "REFUNDED" as const, refundedAt: now } : {}),
        },
      });
      await audit({
        actorId: "whop",
        action: AUDIT_ACTIONS.refundCreated,
        whopRef: paymentId,
        invoiceId: invoice.id,
        amountCents: isFull ? invoice.amountCents : refundedTotalCents,
        detail: {
          reason: "refunded from Whop dashboard",
          partial: !isFull,
          refundedTotalCents,
          invoiceTotalCents: invoice.amountCents,
        },
      });
      return { outcome: "reconciled", note: "dashboard refund mirrored locally" };
    }
    await audit({
      actorId: "whop",
      action: AUDIT_ACTIONS.webhookUnmatched,
      whopRef: paymentId,
      detail: { type, note: "no PAID local invoice to mirror" },
    });
    return { outcome: "unmatched", note: "no PAID local invoice to mirror" };
  }

  // Known-but-unhandled types are recorded (WhopEvent row) without noise.
  return { outcome: "no-rule", note: "event type recorded, no reconciliation rule" };
}

/** Parse a stored WhopEvent payload back into (type, data). */
export function parseWhopEventPayload(
  payload: string
): { type: string; data: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(payload || "{}") as {
      id?: string;
      type?: string;
      data?: Record<string, unknown>;
    };
    return {
      type: parsed.type || "unknown",
      data: parsed.data && typeof parsed.data === "object" ? parsed.data : {},
    };
  } catch {
    return { type: "unknown", data: {} };
  }
}
