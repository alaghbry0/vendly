import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import type { LicenseDTO } from "@/lib/types";

// GET /api/licenses — my license keys
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const keys = await db.licenseKey.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
    const data: LicenseDTO[] = keys.map((k) => ({
      id: k.id,
      key: k.key,
      status: k.status,
      planName: k.planName,
      activations: k.activations,
      maxActivations: k.maxActivations,
      activatedAt: k.activatedAt?.toISOString() ?? null,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
      product: { id: k.product.id, title: k.product.title, coverTheme: k.product.coverTheme },
    }));
    return Response.json({ licenses: data });
  } catch (e) {
    return errorResponse(e);
  }
}
