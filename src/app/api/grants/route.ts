import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import type { GrantDTO } from "@/lib/types";

// GET /api/grants — my access grants (Discord/Telegram roles, licenses, files)
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const grants = await db.accessGrant.findMany({
      where: { userId: user.id },
      include: { product: true },
      orderBy: { createdAt: "desc" },
    });
    const data: GrantDTO[] = grants.map((g) => ({
      id: g.id,
      provider: g.provider,
      role: g.role,
      status: g.status,
      grantedAt: g.grantedAt.toISOString(),
      revokedAt: g.revokedAt?.toISOString() ?? null,
      product: { id: g.product.id, title: g.product.title, coverTheme: g.product.coverTheme },
    }));
    return Response.json({ grants: data });
  } catch (e) {
    return errorResponse(e);
  }
}
