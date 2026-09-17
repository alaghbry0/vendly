import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { serializePlan } from "@/lib/serialize";
import type { PaymentMethodDTO, SubscriptionDTO } from "@/lib/types";

// GET /api/subscriptions — my subscriptions with product/plan/invoice stats
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const subs = await db.subscription.findMany({
      where: { userId: user.id },
      include: {
        product: { include: { creator: true } },
        plan: true,
        paymentMethod: true,
        invoices: { where: { status: "PAID" } },
      },
      orderBy: { createdAt: "desc" },
    });

    const data: SubscriptionDTO[] = subs.map((s) => ({
      id: s.id,
      status: s.status,
      gateway: s.gateway,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      currentPeriodStart: s.currentPeriodStart.toISOString(),
      currentPeriodEnd: s.currentPeriodEnd.toISOString(),
      trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
      dunningAttempts: s.dunningAttempts,
      createdAt: s.createdAt.toISOString(),
      product: {
        id: s.product.id,
        title: s.product.title,
        coverTheme: s.product.coverTheme,
        category: s.product.category,
        accessType: (s.product.accessType || "LINK").split(",").map((x) => x.trim()).filter(Boolean),
        creator: { name: s.product.creator.name },
      },
      plan: serializePlan(s.plan),
      paymentMethod: s.paymentMethod
        ? ({
            id: s.paymentMethod.id,
            type: s.paymentMethod.type,
            gateway: s.paymentMethod.gateway,
            brand: s.paymentMethod.brand,
            last4: s.paymentMethod.last4,
            expMonth: s.paymentMethod.expMonth,
            expYear: s.paymentMethod.expYear,
            email: s.paymentMethod.email,
            walletAddress: s.paymentMethod.walletAddress,
            chain: s.paymentMethod.chain,
            isDefault: s.paymentMethod.isDefault,
          } as PaymentMethodDTO)
        : null,
      invoiceCount: s.invoices.length,
      totalPaidCents: s.invoices.reduce((sum, i) => sum + i.amountCents, 0),
    }));

    return Response.json({ subscriptions: data });
  } catch (e) {
    return errorResponse(e);
  }
}
