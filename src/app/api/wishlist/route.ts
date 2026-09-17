import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { serializeProductCard } from "@/lib/serialize";

// GET /api/wishlist — saved products for the signed-in member
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const items = await db.wishlistItem.findMany({
      where: { userId: user.id },
      include: { product: { include: { creator: true, plans: true } } },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({
      items: items.map((it) => ({
        id: it.id,
        createdAt: it.createdAt.toISOString(),
        product: serializeProductCard(it.product),
      })),
      productIds: items.map((it) => it.productId),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/wishlist {productId} — toggle save/unsave, returns the new state
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const productId = String(body.productId || "");
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) throw new HttpError(404, "Product not found.");

    const existing = await db.wishlistItem.findUnique({
      where: { userId_productId: { userId: user.id, productId } },
    });
    if (existing) {
      await db.wishlistItem.delete({ where: { id: existing.id } });
      return Response.json({ saved: false });
    }
    await db.wishlistItem.create({ data: { userId: user.id, productId } });
    return Response.json({ saved: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
