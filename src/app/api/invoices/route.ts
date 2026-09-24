import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import type { InvoiceDTO } from "@/lib/types";

// GET /api/invoices — my billing history (optionally ?subscriptionId=)
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const subscriptionId = url.searchParams.get("subscriptionId");

    const invoices = await db.invoice.findMany({
      where: { userId: user.id, ...(subscriptionId ? { subscriptionId } : {}) },
      orderBy: { createdAt: "desc" },
    });

    // Invoice.productId is a plain FK (no Prisma relation) — resolve products manually.
    const productIds = [...new Set(invoices.map((i) => i.productId).filter((x): x is string => !!x))];
    const products = productIds.length
      ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, title: true, coverTheme: true } })
      : [];
    const productMap = new Map(products.map((p) => [p.id, p]));

    const data: InvoiceDTO[] = invoices.map((i) => ({
      id: i.id,
      number: i.number,
      description: i.description,
      amountCents: i.amountCents,
      refundedCents: i.refundedCents ?? 0,
      discountCents: i.discountCents ?? 0,
      promoCode: i.promoCode ?? null,
      status: i.status,
      gateway: i.gateway,
      createdAt: i.createdAt.toISOString(),
      paidAt: i.paidAt?.toISOString() ?? null,
      periodStart: i.periodStart?.toISOString() ?? null,
      periodEnd: i.periodEnd?.toISOString() ?? null,
      product: i.productId ? productMap.get(i.productId) ?? null : null,
    }));

    return Response.json({ invoices: data });
  } catch (e) {
    return errorResponse(e);
  }
}
