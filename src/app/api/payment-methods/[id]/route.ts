import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";

// PATCH /api/payment-methods/[id] — set default
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const pm = await db.paymentMethod.findUnique({ where: { id } });
    if (!pm || pm.userId !== user.id) throw new HttpError(404, "Payment method not found.");
    await db.paymentMethod.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    await db.paymentMethod.update({ where: { id }, data: { isDefault: true } });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/payment-methods/[id]
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const pm = await db.paymentMethod.findUnique({ where: { id } });
    if (!pm || pm.userId !== user.id) throw new HttpError(404, "Payment method not found.");
    const inUse = await db.subscription.count({
      where: { paymentMethodId: id, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
    });
    if (inUse > 0) throw new HttpError(409, "This method is attached to an active subscription — switch that subscription to another method first.");
    await db.paymentMethod.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
