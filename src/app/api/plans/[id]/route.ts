import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { serializePlan } from "@/lib/serialize";

// PATCH /api/plans/[id] — edit a plan tier (product owner only).
// body: {name?, description?, priceCents?, interval?, trialDays?, badge?, features?, active?}
// Note: price changes apply to NEW subscriptions only; existing ones keep their
// current terms until they upgrade.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const plan = await db.plan.findUnique({ where: { id }, include: { product: true } });
    if (!plan) throw new HttpError(404, "Plan not found.");
    if (plan.product.creatorId !== user.id) throw new HttpError(403, "You don't own this product.");

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (typeof body.name === "string" && body.name.trim().length >= 2) {
      const dupe = await db.plan.findFirst({
        where: { productId: plan.productId, name: body.name.trim(), NOT: { id: plan.id } },
      });
      if (dupe) throw new HttpError(409, "A plan with that name already exists on this product.");
      patch.name = body.name.trim();
    }
    if (typeof body.description === "string") patch.description = body.description.slice(0, 200) || null;
    if (body.priceCents !== undefined) {
      const priceCents = Math.round(Number(body.priceCents));
      if (priceCents < 100 || priceCents > 1000000) throw new HttpError(400, "Price must be between $1 and $10,000.");
      patch.priceCents = priceCents;
    }
    if (body.interval === "month" || body.interval === "year") patch.interval = body.interval;
    if (body.trialDays !== undefined) patch.trialDays = Math.min(30, Math.max(0, Math.round(Number(body.trialDays) || 0)));
    if (typeof body.badge === "string") patch.badge = body.badge.trim().slice(0, 20) || null;
    if (Array.isArray(body.features)) patch.features = JSON.stringify(body.features.map(String).slice(0, 8));
    if (typeof body.active === "boolean") {
      if (!body.active) {
        const activeCount = await db.plan.count({ where: { productId: plan.productId, active: true, NOT: { id: plan.id } } });
        if (activeCount === 0) throw new HttpError(400, "A product needs at least one active plan.");
      }
      patch.active = body.active;
    }

    const updated = await db.plan.update({ where: { id }, data: patch });
    return Response.json({ plan: serializePlan(updated) });
  } catch (e) {
    return errorResponse(e);
  }
}
