import { db } from "@/lib/db";
import { errorResponse } from "@/lib/session";
import { getNow } from "@/lib/clock";

// POST /api/licenses/validate { key } — public validation endpoint that a
// downloaded desktop app / SaaS would call to verify an install.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const key = String(body.key || "").trim().toUpperCase();
    const lic = await db.licenseKey.findUnique({
      where: { key },
      include: { product: { select: { id: true, title: true } } },
    });
    if (!lic) {
      return Response.json({ valid: false, reason: "NOT_FOUND" }, { status: 404 });
    }
    const now = await getNow();
    if (lic.status === "REVOKED") {
      return Response.json({ valid: false, reason: "REVOKED", revokedAt: lic.revokedAt });
    }
    const sub = lic.subscriptionId
      ? await db.subscription.findUnique({ where: { id: lic.subscriptionId } })
      : null;
    if (sub && !["ACTIVE", "TRIALING"].includes(sub.status)) {
      return Response.json({ valid: false, reason: "SUBSCRIPTION_INACTIVE", subscriptionStatus: sub.status });
    }
    await db.licenseKey.update({ where: { id: lic.id }, data: { lastUsedAt: now } });
    return Response.json({
      valid: true,
      product: { id: lic.product.id, title: lic.product.title },
      plan: lic.planName,
      activations: lic.activations,
      maxActivations: lic.maxActivations,
      activatedAt: lic.activatedAt,
      lastUsedAt: now,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
