import { errorResponse, requireUser } from "@/lib/session";
import { resetClock, runBilling } from "@/lib/billing";

// POST /api/billing/reset — return to real time (runs billing first)
export async function POST(req: Request) {
  try {
    await requireUser(req);
    await runBilling();
    await resetClock();
    return Response.json({ ok: true, message: "Clock reset to live time." });
  } catch (e) {
    return errorResponse(e);
  }
}
