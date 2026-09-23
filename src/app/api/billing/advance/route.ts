import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { advanceDays } from "@/lib/billing";

// POST /api/billing/advance { days } — time machine: advances the simulated
// clock and runs the recurring billing engine (renewals, dunning, cancels).
// The run is recorded in the worker history with source TIME_MACHINE.
export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(90, Number(body.days) || 1));
    const summary = await advanceDays(days);
    await db.workerRun
      .create({
        data: {
          source: "TIME_MACHINE",
          durationMs: Date.now() - t0,
          renewals: summary.renewals,
          renewalsFailed: summary.renewalsFailed,
          canceled: summary.canceled,
          trialsConverted: summary.trialsConverted,
          invoicesCreated: summary.invoicesCreated,
          events: JSON.stringify([`Time machine +${days}d`, ...summary.events].slice(0, 40)),
        },
      })
      .catch(() => undefined);
    return Response.json(summary);
  } catch (e) {
    return errorResponse(e);
  }
}
