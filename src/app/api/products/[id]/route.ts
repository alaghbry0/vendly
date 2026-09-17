import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { serializeProductDetail, hasActiveAccess } from "@/lib/serialize";

// GET /api/products/[id] — product detail
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const product = await db.product.findUnique({
      where: { id },
      include: {
        creator: true,
        plans: { where: { active: true }, orderBy: { sortOrder: "asc" } },
        assets: { orderBy: { createdAt: "asc" } },
        reviews: { orderBy: { createdAt: "desc" }, take: 20 },
        affiliateProgram: { select: { commissionBps: true, active: true } },
      },
    });
    if (!product) throw new HttpError(404, "Product not found");

    let hasAccess = false;
    const auth = req.headers.get("x-user-id");
    if (auth) hasAccess = await hasActiveAccess(auth, id);

    return Response.json({ product: serializeProductDetail(product, hasAccess) });
  } catch (e) {
    return errorResponse(e);
  }
}

// PATCH /api/products/[id] — update product (owner only)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new HttpError(404, "Product not found");
    if (product.creatorId !== user.id) throw new HttpError(403, "You don't own this product.");

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string" && body.title.trim().length >= 3) patch.title = body.title.trim();
    if (typeof body.tagline === "string") patch.tagline = body.tagline.slice(0, 120) || null;
    if (typeof body.description === "string" && body.description.trim().length >= 10) patch.description = body.description.trim();
    if (typeof body.category === "string") patch.category = body.category;
    if (typeof body.status === "string" && ["ACTIVE", "PAUSED"].includes(body.status)) patch.status = body.status;
    if (typeof body.featured === "boolean") patch.featured = body.featured;
    if (typeof body.discordRoleName === "string") patch.discordRoleName = body.discordRoleName || null;
    if (typeof body.telegramChannel === "string") patch.telegramChannel = body.telegramChannel || null;
    if (Array.isArray(body.accessType)) {
      patch.accessType = body.accessType.filter((s: unknown) => typeof s === "string" && s).join(",") || "LINK";
    }

    await db.product.update({ where: { id }, data: patch });
    const updated = await db.product.findUnique({
      where: { id },
      include: { creator: true, plans: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
    });
    const auth = req.headers.get("x-user-id");
    const hasAccess = auth ? await hasActiveAccess(auth, id) : false;
    const withExtras = updated
      ? await db.product.findUnique({
          where: { id },
          include: {
            creator: true,
            plans: { where: { active: true }, orderBy: { sortOrder: "asc" } },
            assets: { orderBy: { createdAt: "asc" } },
            reviews: { orderBy: { createdAt: "desc" }, take: 20 },
            affiliateProgram: { select: { commissionBps: true, active: true } },
          },
        })
      : null;
    return Response.json({ product: withExtras ? serializeProductDetail(withExtras, hasAccess) : null });
  } catch (e) {
    return errorResponse(e);
  }
}
