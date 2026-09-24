import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { serializePlan } from "@/lib/serialize";

// GET /api/creator/orders — all invoices across the creator's products
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const ownedProducts = await db.product.findMany({ where: { creatorId: user.id }, select: { id: true } });
    const productIds = ownedProducts.map((p) => p.id);
    if (productIds.length === 0) return Response.json({ orders: [] });

    const invoices = await db.invoice.findMany({
      where: { productId: { in: productIds } },
      include: { user: true, subscription: { include: { plan: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, title: true, coverTheme: true, refundPolicy: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const orders = invoices.map((i) => ({
      id: i.id,
      number: i.number,
      customer: { id: i.user.id, name: i.user.name || i.user.email, email: i.user.email, avatarColor: i.user.avatarColor },
      product: (() => {
        const p = i.productId ? productMap.get(i.productId) : undefined;
        return {
          id: p?.id || "",
          title: p?.title || "—",
          coverTheme: p?.coverTheme || "emerald",
          // The product's default full-refund access policy — pre-selects
          // the choice in the refund dialog.
          refundPolicy: p?.refundPolicy === "KEEP_ACCESS" ? "KEEP_ACCESS" : "REVOKE",
        };
      })(),
      planName: i.subscription?.plan?.name || null,
      description: i.description,
      amountCents: i.amountCents,
      refundedCents: i.refundedCents ?? 0,
      discountCents: i.discountCents ?? 0,
      promoCode: i.promoCode ?? null,
      status: i.status,
      gateway: i.gateway,
      createdAt: i.createdAt.toISOString(),
      paidAt: i.paidAt?.toISOString() ?? null,
    }));
    return Response.json({ orders });
  } catch (e) {
    return errorResponse(e);
  }
}
