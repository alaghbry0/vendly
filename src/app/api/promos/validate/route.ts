import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { validatePromoForPlan } from "@/lib/promos";

// POST /api/promos/validate {code, planId} — validation used by the checkout
// order summary to preview a discount before paying.
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "");
    const planId = String(body.planId || "");
    if (!planId) throw new HttpError(400, "Missing planId.");

    const result = await validatePromoForPlan(code, planId);
    if (!result.valid) throw new HttpError(404, result.reason || "Invalid promo code.");

    return Response.json({
      valid: true,
      code: result.promo!.code,
      kind: result.promo!.kind,
      value: result.promo!.value,
      discountCents: result.discountCents,
      durationMonths: result.promo!.durationMonths,
      description: result.description,
      appliedFor: user.name || user.email,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
