import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { scopedAuditEvents, auditEventsToCsv } from "@/lib/audit-scope";
import { rateLimit } from "@/lib/rate-limit";

// GET /api/creator/audit/export — CSV download of the SAME creator-scoped
// audit trail the UI shows (identical scoping + filters via the shared lib,
// so the file can never diverge from the screen).
//
// Query params: identical to GET /api/creator/audit (action, q, from, to) —
// plus take is fixed at 2000 (export upper bound).
//
// Response: text/csv attachment (RFC 4180, escaped cells, CRLF rows).
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const limited = rateLimit({ req, bucket: "audit-export", userId: user.id, max: 10, windowMs: 60_000 });
    if (limited) return limited;

    const url = new URL(req.url);
    const actionFilter = url.searchParams.get("action");
    const q = url.searchParams.get("q");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const page = await scopedAuditEvents(user.id, {
      action: actionFilter,
      q,
      take: 2000,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
    });
    const events = page.events;
    if (events.length === 0) throw new HttpError(404, "No audit events match these filters — nothing to export.");

    const csv = auditEventsToCsv(events);
    const now = await getNow();
    const stamp = now.toISOString().slice(0, 10);
    const filename = `vendly-audit-${stamp}-${events.length}rows.csv`;

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
