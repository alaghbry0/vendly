import { errorResponse, requireUser } from "@/lib/session";
import { resetClock, runBilling } from "@/lib/billing";
import { getClockState } from "@/lib/clock";

// POST /api/billing/reset — return to real time (runs billing first so
// everything simulated stays settled), then reports the fresh clock state.
export async function POST(req: Request) {
  try {
    await requireUser(req);
    await runBilling();
    await resetClock();
    const clock = await getClockState();
    return Response.json({ ok: true, message: "Clock reset to live time.", clock });
  } catch (e) {
    return errorResponse(e);
  }
}
