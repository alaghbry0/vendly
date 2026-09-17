import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { generatePromoCode } from "@/lib/promos";
import type { PromoCodeDTO } from "@/lib/types";

// GET /api/promos — creator's promo codes with per-code discount totals
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const promos = await db.promoCode.findMany({
      where: { creatorId: user.id },
      include: {
        product: { select: { id: true, title: true } },
        redemptions: { select: { discountCents: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const data: (PromoCodeDTO & { discountGivenCents: number })[] = promos.map((p) => ({
      id: p.id,
      code: p.code,
      kind: p.kind as "PERCENT" | "FIXED",
      value: p.value,
      productId: p.productId,
      productTitle: p.product?.title ?? null,
      maxRedemptions: p.maxRedemptions,
      timesRedeemed: p.timesRedeemed,
      durationMonths: p.durationMonths,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      active: p.active,
      createdAt: p.createdAt.toISOString(),
      discountGivenCents: p.redemptions.reduce((s, r) => s + r.discountCents, 0),
    }));
    return Response.json({ promos: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/promos — create a promo code
// body: {code?, kind: PERCENT|FIXED, value, productId?, maxRedemptions?, durationMonths?, expiresAt?}
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const kind = String(body.kind || "PERCENT") === "FIXED" ? "FIXED" : "PERCENT";
    const value = Math.round(Number(body.value) || 0);
    if (value <= 0) throw new HttpError(400, "Enter a discount value greater than zero.");
    if (kind === "PERCENT" && value > 100) throw new HttpError(400, "Percent discounts can't exceed 100%.");
    if (kind === "FIXED" && value > 100000) throw new HttpError(400, "That fixed amount is too large.");

    let code = String(body.code || "").trim().toUpperCase();
    if (code && !/^[A-Z0-9-]{3,24}$/.test(code)) {
      throw new HttpError(400, "Codes use 3–24 letters, numbers and dashes.");
    }
    if (!code) code = generatePromoCode();

    const existing = await db.promoCode.findUnique({ where: { code } });
    if (existing) throw new HttpError(409, "That code already exists.");

    let productId: string | null = null;
    if (body.productId && body.productId !== "ALL") {
      const product = await db.product.findFirst({
        where: { id: String(body.productId), creatorId: user.id },
      });
      if (!product) throw new HttpError(404, "Product not found.");
      productId = product.id;
    }

    const maxRedemptions = Math.max(0, Math.round(Number(body.maxRedemptions) || 0));
    const durationMonths = Math.min(12, Math.max(1, Math.round(Number(body.durationMonths) || 1)));
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      const t = new Date(String(body.expiresAt)).getTime();
      if (!Number.isNaN(t)) expiresAt = new Date(t);
    }

    const promo = await db.promoCode.create({
      data: { creatorId: user.id, productId, code, kind, value, maxRedemptions, durationMonths, expiresAt },
    });

    return Response.json(
      {
        promo: {
          id: promo.id,
          code: promo.code,
          kind: promo.kind,
          value: promo.value,
          productId: promo.productId,
          productTitle: null,
          maxRedemptions: promo.maxRedemptions,
          timesRedeemed: 0,
          durationMonths: promo.durationMonths,
          expiresAt: promo.expiresAt?.toISOString() ?? null,
          active: promo.active,
          createdAt: promo.createdAt.toISOString(),
          discountGivenCents: 0,
        },
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
