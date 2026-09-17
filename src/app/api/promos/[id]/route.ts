import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";

// PATCH /api/promos/[id] {active?} — pause/resume a code
// DELETE /api/promos/[id] — remove a code and its redemptions
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const promo = await db.promoCode.findFirst({ where: { id, creatorId: user.id } });
    if (!promo) throw new HttpError(404, "Promo code not found.");

    const body = await req.json().catch(() => ({}));
    const active = typeof body.active === "boolean" ? body.active : promo.active;
    await db.promoCode.update({ where: { id }, data: { active } });
    return Response.json({ ok: true, active });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const promo = await db.promoCode.findFirst({ where: { id, creatorId: user.id } });
    if (!promo) throw new HttpError(404, "Promo code not found.");

    await db.promoRedemption.deleteMany({ where: { promoId: id } });
    await db.promoCode.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
