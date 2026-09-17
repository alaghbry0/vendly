import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";

// GET /api/affiliates/programs — creator view: programs, joined affiliates,
// clicks/conversions/earnings per program and per affiliate
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const programs = await db.affiliateProgram.findMany({
      where: { creatorId: user.id },
      include: {
        product: { select: { id: true, title: true, coverTheme: true, status: true } },
        links: {
          include: {
            user: { select: { id: true, name: true, email: true, avatarColor: true } },
            commissions: { select: { amountCents: true, status: true, createdAt: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = programs.map((p) => {
      const links = p.links.map((l) => ({
        id: l.id,
        code: l.code,
        clicks: l.clicks,
        conversions: l.conversions,
        active: l.active,
        joinedAt: l.createdAt.toISOString(),
        earnedPaidCents: l.commissions.filter((c) => c.status === "PAID").reduce((s, c) => s + c.amountCents, 0),
        earnedPendingCents: l.commissions.filter((c) => c.status === "PENDING").reduce((s, c) => s + c.amountCents, 0),
        affiliate: l.user,
      }));
      return {
        id: p.id,
        commissionBps: p.commissionBps,
        active: p.active,
        createdAt: p.createdAt.toISOString(),
        product: p.product,
        affiliateCount: links.length,
        totalClicks: links.reduce((s, l) => s + l.clicks, 0),
        totalConversions: links.reduce((s, l) => s + l.conversions, 0),
        paidCents: links.reduce((s, l) => s + l.earnedPaidCents, 0),
        pendingCents: links.reduce((s, l) => s + l.earnedPendingCents, 0),
        affiliates: links,
      };
    });
    return Response.json({ programs: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/affiliates/programs {productId, commissionBps, active?} — upsert a
// program for one of the caller's products (one program per product).
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const productId = String(body.productId || "");
    const commissionBps = Math.round(Number(body.commissionBps) || 0);

    const product = await db.product.findFirst({ where: { id: productId, creatorId: user.id } });
    if (!product) throw new HttpError(404, "Product not found.");
    if (commissionBps < 100 || commissionBps > 9000) {
      throw new HttpError(400, "Commission must be between 1% and 90%.");
    }
    const active = typeof body.active === "boolean" ? body.active : true;

    const program = await db.affiliateProgram.upsert({
      where: { productId },
      update: { commissionBps, active },
      create: { productId, creatorId: user.id, commissionBps, active },
    });
    return Response.json(
      { program: { id: program.id, commissionBps: program.commissionBps, active: program.active } },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
