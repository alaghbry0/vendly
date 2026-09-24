import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { advanceDays } from "@/lib/billing";
import { getClockState, getNow } from "@/lib/clock";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/billing/advance { days } — time machine: advances the simulated
// clock (a persistent offset that keeps ticking) and runs the recurring
// billing engine (renewals — REAL Whop charges for Whop subs, dunning,
// cancels). The run is recorded in the worker history with source
// TIME_MACHINE, and the response carries the fresh clock state so every
// client re-anchors its relative times.
export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const user = await requireUser(req);
    // The time machine runs REAL Whop charges — cap how often a user can
    // trigger it (the engine itself is mutex-guarded; this bounds load).
    const limited = rateLimit({ req, bucket: "billing-advance", userId: user.id, max: 6, windowMs: 60_000 });
    if (limited) return limited;
    const body = await req.json().catch(() => ({}));
    const days = Math.max(1, Math.min(90, Number(body.days) || 1));
    const summary = await advanceDays(days);
    const at = await getNow();
    await db.workerRun
      .create({
        data: {
          startedAt: at,
          // Real wall-clock stamp — ordering/retention anchor (see tick route).
          recordedAt: new Date(),
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
    const clock = await getClockState();
    return Response.json({ ...summary, clock });
  } catch (e) {
    return errorResponse(e);
  }
}
