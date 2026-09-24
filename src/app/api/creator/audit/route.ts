import { errorResponse, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { scopedAuditEvents } from "@/lib/audit-scope";

// GET /api/creator/audit — read-only money-event audit trail, scoped to the
// creator's products. Every row the billing engine, refund path, webhook
// reconciliation and rate limiter writes (AuditLog) is surfaced here with:
//   • events on THEIR invoices/subscriptions (charges, refunds, cancels…)
//   • events THEY initiated (refunds issued, webhook retries, rate-limit hits)
//
// Query params:
//   action  — exact action filter (e.g. refund.created)
//   q       — search whopRef / invoice number / product / actor / buyer email
//   from,to — platform-clock ISO bounds on `at` (inclusive)
//   take    — max rows per page (1..2000, default 200)
//   skip    — pagination offset over the SCOPED result (UI "load more")
//
// Response: { events, hasMore, scanned, now } — `hasMore` is true when more
// scoped events exist past this page, so the UI can offer "Load more"
// instead of silently truncating at `take`.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const actionFilter = url.searchParams.get("action");
    const q = url.searchParams.get("q");
    const take = Math.min(2000, Math.max(1, Number(url.searchParams.get("take")) || 200));
    const skip = Math.min(2000, Math.max(0, Number(url.searchParams.get("skip")) || 0));
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const page = await scopedAuditEvents(user.id, {
      action: actionFilter,
      q,
      take,
      skip,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
    });

    return Response.json({ events: page.events, hasMore: page.hasMore, scanned: page.scanned, now: (await getNow()).toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
