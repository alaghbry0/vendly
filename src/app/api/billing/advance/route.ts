import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { advanceDays } from "@/lib/billing";

// POST /api/billing/advance { days } — time machine: advances the simulated
// clock and runs the recurring billing engine (renewals, dunning, cancels).
export async function POST(req: Request) {
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(90, Number(body.days) || 1));
    const summary = await advanceDays(days);
    return Response.json(summary);
  } catch (e) {
    return errorResponse(e);
  }
}
