import { db } from "@/lib/db";
import { getNow } from "@/lib/clock";

// ============ Money-event audit trail ============
//
// Every money-moving or lifecycle event (charge, decline, refund, cancel,
// trial conversion, webhook reconciliation, rate-limit blocks on money
// endpoints) writes one immutable AuditLog row, stamped on the PLATFORM
// clock. Failures to write an audit row must never break the money path —
// the write is best-effort with the error surfaced to the server log.

export interface AuditInput {
  actorId?: string; // user id | "system" | "worker" | "whop"
  action: string;
  gateway?: string | null;
  amountCents?: number;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  whopRef?: string | null;
  detail?: Record<string, unknown>;
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    const at = await getNow();
    await db.auditLog.create({
      data: {
        at,
        actorId: input.actorId ?? "system",
        action: input.action,
        gateway: input.gateway ?? null,
        amountCents: input.amountCents ?? 0,
        invoiceId: input.invoiceId ?? null,
        subscriptionId: input.subscriptionId ?? null,
        whopRef: input.whopRef ?? null,
        detail: JSON.stringify(input.detail ?? {}),
      },
    });
  } catch (e) {
    // Audit is observability, not a gate — never fail the money path.
    console.error("[audit] failed to write", input.action, e);
  }
}

// Canonical action names (kept in one place so the UI + queries stay in sync).
export const AUDIT_ACTIONS = {
  checkoutCharged: "checkout.charged",
  trialStarted: "trial.started",
  chargeSucceeded: "charge.succeeded",
  chargeFailed: "charge.failed",
  chargeDeferred: "charge.deferred",
  compRenewal: "comp.renewal",
  trialConverted: "trial.converted",
  refundCreated: "refund.created",
  refundFailed: "refund.failed",
  subscriptionCanceled: "subscription.canceled",
  subscriptionCanceledEngine: "subscription.canceled.dunning",
  planChanged: "plan.changed",
  webhookReconciled: "webhook.reconciled",
  webhookUnmatched: "webhook.unmatched",
  webhookRejected: "webhook.rejected",
  webhookRetry: "webhook.retry",
  rateLimited: "rate.limited",
} as const;
