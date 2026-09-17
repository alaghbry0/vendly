import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { serializePlan } from "@/lib/serialize";

// GET /api/creator/subscribers — all subscribers across the creator's products
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const products = await db.product.findMany({ where: { creatorId: user.id }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    if (productIds.length === 0) return Response.json({ subscribers: [] });

    const subs = await db.subscription.findMany({
      where: { productId: { in: productIds } },
      include: { user: true, plan: true, product: true, paymentMethod: true, invoices: { where: { status: "PAID" } } },
      orderBy: { createdAt: "desc" },
    });

    const subscribers = subs.map((s) => ({
      id: s.id,
      customer: {
        id: s.user.id,
        name: s.user.name || s.user.email,
        email: s.user.email,
        avatarColor: s.user.avatarColor,
        discordHandle: s.user.discordHandle,
        telegramHandle: s.user.telegramHandle,
      },
      product: { id: s.product.id, title: s.product.title, coverTheme: s.product.coverTheme },
      plan: serializePlan(s.plan),
      status: s.status,
      gateway: s.gateway,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      dunningAttempts: s.dunningAttempts,
      currentPeriodEnd: s.currentPeriodEnd.toISOString(),
      trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
      lifetimeValueCents: s.invoices.reduce((sum, i) => sum + i.amountCents, 0),
      paymentMethod: s.paymentMethod
        ? {
            type: s.paymentMethod.type,
            brand: s.paymentMethod.brand,
            last4: s.paymentMethod.last4,
            email: s.paymentMethod.email,
            walletAddress: s.paymentMethod.walletAddress,
          }
        : null,
    }));
    return Response.json({ subscribers });
  } catch (e) {
    return errorResponse(e);
  }
}
