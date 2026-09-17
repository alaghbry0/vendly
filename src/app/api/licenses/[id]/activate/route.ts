import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { dispatchEvent } from "@/lib/webhooks";

// POST /api/licenses/[id]/activate — simulate activating on a new device
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const lic = await db.licenseKey.findUnique({ where: { id }, include: { product: true } });
    if (!lic || lic.userId !== user.id) throw new HttpError(404, "License not found.");
    if (lic.status !== "ACTIVE") throw new HttpError(409, `License is ${lic.status.toLowerCase()} and cannot be activated.`);
    if (lic.activations >= lic.maxActivations) {
      throw new HttpError(409, `Device limit reached (${lic.maxActivations}). Revoke the license or upgrade your tier.`);
    }
    const now = await getNow();
    await db.licenseKey.update({
      where: { id },
      data: { activations: { increment: 1 }, activatedAt: lic.activatedAt ?? now, lastUsedAt: now },
    });
    return Response.json({
      ok: true,
      activations: lic.activations + 1,
      maxActivations: lic.maxActivations,
      device: `device-${Math.random().toString(36).slice(2, 8)}`,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/licenses/[id]/activate — revoke this license (portal action)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const lic = await db.licenseKey.findUnique({ where: { id }, include: { product: true } });
    if (!lic || lic.userId !== user.id) throw new HttpError(404, "License not found.");
    const now = await getNow();
    await db.licenseKey.update({ where: { id }, data: { status: "REVOKED", revokedAt: now, activations: 0 } });
    await dispatchEvent(lic.product.creatorId, "license_key.revoked", {
      license: { id, key: lic.key },
      product: { id: lic.product.id, title: lic.product.title },
      customer: { id: user.id },
    });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
