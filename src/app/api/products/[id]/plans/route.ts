import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { serializePlan } from "@/lib/serialize";

// POST /api/products/[id]/plans — add a plan tier to one of my products
// body: {name, description?, priceCents, interval: month|year, trialDays?, badge?, features: string[], sortOrder?}
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new HttpError(404, "Product not found.");
    if (product.creatorId !== user.id) throw new HttpError(403, "You don't own this product.");

    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const priceCents = Math.round(Number(body.priceCents) || 0);
    const interval = body.interval === "year" ? "year" : "month";
    if (name.length < 2) throw new HttpError(400, "Plan name must be at least 2 characters.");
    if (priceCents < 100 || priceCents > 1000000) throw new HttpError(400, "Price must be between $1 and $10,000.");

    const dupe = await db.plan.findFirst({ where: { productId: id, name } });
    if (dupe) throw new HttpError(409, "A plan with that name already exists on this product.");

    const count = await db.plan.count({ where: { productId: id } });
    if (count >= 6) throw new HttpError(400, "Products can have at most 6 plan tiers.");

    const plan = await db.plan.create({
      data: {
        productId: id,
        name,
        description: typeof body.description === "string" ? body.description.slice(0, 200) || null : null,
        priceCents,
        interval,
        trialDays: Math.min(30, Math.max(0, Math.round(Number(body.trialDays) || 0))),
        badge: typeof body.badge === "string" && body.badge.trim() ? body.badge.trim().slice(0, 20) : null,
        features: JSON.stringify(Array.isArray(body.features) ? body.features.map(String).slice(0, 8) : []),
        sortOrder: Math.min(10, Math.max(0, Math.round(Number(body.sortOrder) || count))),
      },
    });
    return Response.json({ plan: serializePlan(plan) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
