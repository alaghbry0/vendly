import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { revokeAccess, dispatchEvent } from "@/lib/webhooks";
import { refundWhopPayment, WhopApiError } from "@/lib/whop";
import { audit, AUDIT_ACTIONS } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/invoices/[id]/refund — creator-initiated full or partial refund.
//
// Body: { reason?: string, amountCents?: number, keepAccess?: boolean }
//   • amountCents omitted  → FULL refund of the remaining balance.
//   • amountCents = N      → PARTIAL refund (1 ≤ N ≤ remaining balance).
//   • keepAccess           → full-refund ACCESS POLICY: instead of canceling
//     the membership immediately, it stays ACTIVE until currentPeriodEnd
//     (cancelAtPeriodEnd is set; the engine closes it, revokes access and
//     decrements membersCount exactly once at period end). A goodwill-refund
//     policy: money back, buyer keeps what they paid for until it runs out.
//     When OMITTED, the product's `refundPolicy` default applies
//     (REVOKE = close now, KEEP_ACCESS = goodwill until period end) — the
//     refund dialog pre-selects from it, so the API and UI agree by default.
//     Ignored for partial refunds (those never touch access anyway).
//
// Money safety:
//   • Only the product's CREATOR can refund (verified against the invoice's
//     product → creatorId, not the buyer).
//   • Only PAID invoices can be refunded; partial refunds accumulate in
//     refundedCents; a partial refund that covers the remaining balance
//     completes the refund (status → REFUNDED).
//   • Whop-gateway invoices with a whopRef are refunded through the REAL
//     Whop refund API (amount passed through for partials) — if Whop refuses
//     nothing changes locally. Simulated gateways refund in simulation.
//   • FULL refunds (including completing partials) end the buyer's access
//     either NOW (default: subscription canceled, license keys revoked,
//     membersCount fixed) or AT PERIOD END (keepAccess: true).
//     PARTIAL refunds keep the membership active.
//   • One audit row lands regardless of outcome; buyer notified.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const limited = rateLimit({ req, bucket: "refund", userId: user.id, max: 10, windowMs: 60_000 });
    if (limited) return limited;

    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const reason = String(body.reason || "requested_by_customer").slice(0, 200);

    const invoice = await db.invoice.findUnique({
      where: { id },
      include: { subscription: { include: { plan: { include: { product: true } } } } },
    });
    if (!invoice) throw new HttpError(404, "Invoice not found.");

    // Authorization BEFORE state checks — a non-creator must not be able to
    // probe an invoice's status through error-code differences.
    const product = invoice.productId
      ? await db.product.findUnique({ where: { id: invoice.productId } })
      : invoice.subscription?.plan.product ?? null;
    if (!product) throw new HttpError(404, "Product not found for this invoice.");
    if (product.creatorId !== user.id) {
      throw new HttpError(403, "Only the product's creator can issue refunds.");
    }

    // Access policy: explicit body.keepAccess wins; otherwise the product's
    // configured default applies (KEEP_ACCESS = goodwill refunds by default).
    const keepAccess =
      typeof body.keepAccess === "boolean" ? body.keepAccess : product.refundPolicy === "KEEP_ACCESS";

    if (invoice.status !== "PAID") throw new HttpError(409, "Only paid invoices can be refunded.");

    // ---- Amount validation ------------------------------------------------
    const alreadyRefunded = invoice.refundedCents || 0;
    const remaining = invoice.amountCents - alreadyRefunded;
    if (remaining <= 0) throw new HttpError(409, "This invoice was already fully refunded.");

    let amountCents = remaining; // default: full refund of what's left
    if (body.amountCents != null) {
      amountCents = Math.round(Number(body.amountCents));
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw new HttpError(400, "Refund amount must be a positive number.");
      }
      if (amountCents > remaining) {
        throw new HttpError(400, `Refund amount exceeds the remaining balance ($${(remaining / 100).toFixed(2)}).`);
      }
    }
    const isFull = amountCents >= remaining; // completing partial = full semantics
    const amountDollars = Math.round(amountCents) / 100;

    const now = await getNow();
    let refundedAtWhop: string | null = null;
    // The ACTUAL cumulative refunded total per the processor — local state
    // follows this, never the request (guards against processors refunding
    // more than asked, e.g. when a partial_amount param is unsupported).
    let actualRefundedTotal = alreadyRefunded + amountCents;
    let processorRefundedMore = false;

    // REAL refund for Whop-charged invoices; simulated otherwise.
    if (invoice.gateway === "WHOP" && invoice.whopRef) {
      try {
        const refunded = await refundWhopPayment(
          invoice.whopRef,
          reason,
          isFull ? undefined : amountDollars // omit partial_amount for a full refund
        );
        // Success check: full → substatus "refunded" (or refunded_amount ==
        // the invoice total); partial → refunded_amount must cover what we
        // asked. If the processor refunded MORE than requested, follow it.
        const refundedTotal = refunded.refunded_amount
          ? Math.round(Number(refunded.refunded_amount.amount) * 100)
          : 0;
        if (refundedTotal > 0) actualRefundedTotal = Math.min(refundedTotal, invoice.amountCents);
        const confirmed =
          (isFull && (refunded.substatus === "refunded" || actualRefundedTotal >= invoice.amountCents)) ||
          (!isFull && actualRefundedTotal >= alreadyRefunded + amountCents - 1); // ± rounding
        if (!confirmed) {
          // Whop acknowledged but didn't confirm the refund — treat as failure.
          throw new HttpError(502, "Whop did not confirm the refund — no changes were made.");
        }
        if (actualRefundedTotal > alreadyRefunded + amountCents) {
          // The processor returned more money than the creator asked for.
          // Record reality and flag it in the response + audit detail.
          processorRefundedMore = true;
        }
        refundedAtWhop = refunded.refunded_at ?? null;
      } catch (e) {
        if (e instanceof HttpError) throw e;
        const msg = e instanceof WhopApiError ? e.message : "Refund request failed.";
        await audit({
          actorId: user.id,
          action: AUDIT_ACTIONS.refundFailed,
          gateway: invoice.gateway,
          amountCents,
          invoiceId: invoice.id,
          subscriptionId: invoice.subscriptionId,
          whopRef: invoice.whopRef,
          detail: { error: msg, reason, requestedAmountCents: amountCents, partial: !isFull },
        });
        throw new HttpError(e instanceof WhopApiError && e.status >= 500 ? 502 : 409, msg);
      }
    }

    // Local state follows the processor's actual refunded total.
    const newRefundedTotal = Math.min(actualRefundedTotal, invoice.amountCents);
    const completesRefund = newRefundedTotal >= invoice.amountCents;
    const effectiveIsFull = isFull || completesRefund;

    // 1) Record the refund on the invoice.
    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        refundedCents: newRefundedTotal,
        ...(effectiveIsFull ? { status: "REFUNDED" as const, refundedAt: now } : {}),
      },
    });

    // 2) Full refunds end the buyer's access — either immediately (default)
    //    or at period end (keepAccess: goodwill refund, membership runs out
    //    naturally and the engine's cancel-at-period-end path closes it).
    //    Partial refunds keep the membership active.
    const sub = invoice.subscription;
    let accessRevoked = false;
    let accessKeptUntil: string | null = null;
    if (effectiveIsFull && sub && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(sub.status)) {
      if (keepAccess) {
        await db.subscription.update({
          where: { id: sub.id },
          data: { cancelAtPeriodEnd: true, pendingWhopRef: null },
        });
        accessKeptUntil = sub.currentPeriodEnd.toISOString();
        // No immediate webhook: the engine's cancel-at-period-end path fires
        // subscription.canceled (once) when access actually ends — dispatching
        // here too would double-fire the terminal event for one membership.
      } else {
        await db.subscription.update({
          where: { id: sub.id },
          data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false },
        });
        await revokeAccess(sub.userId, sub.productId);
        await db.licenseKey.updateMany({
          where: { subscriptionId: sub.id, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: now },
        });
        await db.product.update({ where: { id: sub.productId }, data: { membersCount: { decrement: 1 } } });
        await dispatchEvent(product.creatorId, "subscription.canceled", {
          subscription: { id: sub.id, plan: sub.plan.name, reason: "refunded" },
          product: { id: product.id, title: product.title },
        });
        accessRevoked = true;
      }
    }

    // 3) Audit + buyer notification.
    await audit({
      actorId: user.id,
      action: AUDIT_ACTIONS.refundCreated,
      gateway: invoice.gateway,
      amountCents,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      whopRef: invoice.whopRef,
      detail: {
        reason,
        buyerId: invoice.userId,
        product: product.title,
        refundedAtWhop,
        accessRevoked,
        ...(accessKeptUntil
          ? {
              accessPolicy: "keep-until-period-end",
              accessKeptUntil,
              policySource:
                typeof body.keepAccess === "boolean"
                  ? "creator-choice"
                  : product.refundPolicy === "KEEP_ACCESS"
                    ? "product-default"
                    : "none",
            }
          : {}),
        partial: !effectiveIsFull,
        requestedAmountCents: amountCents,
        refundedTotalCents: newRefundedTotal,
        invoiceTotalCents: invoice.amountCents,
        ...(processorRefundedMore ? { warning: "processor refunded more than requested — local state follows the actual refunded total" } : {}),
      },
    });
    const refundedThisTimeLabel = `$${((newRefundedTotal - alreadyRefunded) / 100).toFixed(2)}`;
    const keptUntilLabel = accessKeptUntil ? new Date(accessKeptUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    await db.notification
      .create({
        data: {
          userId: invoice.userId,
          type: "invoice_refunded",
          title: `${effectiveIsFull ? "Refund issued" : "Partial refund issued"} — ${invoice.number} · ${refundedThisTimeLabel}`,
          body: effectiveIsFull
            ? accessKeptUntil
              ? `${product.title}: your payment was refunded in full and your membership stays active until ${keptUntilLabel} (it will not renew).`
              : `${product.title}: your payment was refunded in full${accessRevoked ? " and the membership was closed" : ""}.`
            : `${product.title}: ${refundedThisTimeLabel} was refunded to your payment method (${(newRefundedTotal / 100).toFixed(2)} of ${(invoice.amountCents / 100).toFixed(2)} total). Your membership stays active.`,
          icon: "bank",
          productId: product.id,
          createdAt: now,
        },
      })
      .catch(() => undefined);

    return Response.json({
      ok: true,
      partial: !effectiveIsFull,
      refundedCents: newRefundedTotal - alreadyRefunded,
      refundedTotalCents: newRefundedTotal,
      message: effectiveIsFull
        ? `Refunded $${(newRefundedTotal / 100).toFixed(2)} in total on ${invoice.number}${invoice.gateway === "WHOP" ? " through Whop" : ""}.${accessKeptUntil ? ` Membership stays active until ${keptUntilLabel}.` : accessRevoked ? " Membership closed and access revoked." : ""}${processorRefundedMore ? " Note: the processor returned more than requested — the invoice is marked fully refunded to match." : ""}`
        : `Partial refund of ${refundedThisTimeLabel} issued on ${invoice.number}${invoice.gateway === "WHOP" ? " through Whop" : ""}. The membership stays active.`,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
