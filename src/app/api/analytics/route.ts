import { errorResponse, requireUser } from "@/lib/session";
import { computeCreatorAnalytics } from "@/lib/analytics";

// GET /api/analytics — creator dashboard metrics (MRR, churn, series…)
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const analytics = await computeCreatorAnalytics(user.id);
    return Response.json({ analytics });
  } catch (e) {
    return errorResponse(e);
  }
}
