import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { generateReferralCode } from "@/lib/affiliates";
import { notify } from "@/lib/notifications";

// GET /api/affiliates/links — my affiliate links with performance + earnings
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const links = await db.affiliateLink.findMany({
      where: { userId: user.id },
      include: {
        program: { include: { product: { include: { creator: true, plans: true } } } },
        commissions: { select: { amountCents: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = links.map((l) => {
      const paid = l.commissions.filter((c) => c.status === "PAID").reduce((s, c) => s + c.amountCents, 0);
      const pending = l.commissions.filter((c) => c.status === "PENDING").reduce((s, c) => s + c.amountCents, 0);
      const product = l.program.product;
      return {
        id: l.id,
        code: l.code,
        clicks: l.clicks,
        conversions: l.conversions,
        active: l.active,
        createdAt: l.createdAt.toISOString(),
        commissionBps: l.program.commissionBps,
        earnedPaidCents: paid,
        earnedPendingCents: pending,
        product: {
          id: product.id,
          title: product.title,
          coverTheme: product.coverTheme,
          status: product.status,
          creator: { id: product.creator.id, name: product.creator.name, avatarColor: product.creator.avatarColor },
        },
      };
    });
    return Response.json({ links: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/affiliates/links {productId} — join an active program (idempotent):
// returns the caller's referral link for that product, creating it on first join.
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const productId = String(body.productId || "");

    const program = await db.affiliateProgram.findUnique({
      where: { productId },
      include: { product: true },
    });
    if (!program || !program.active) throw new HttpError(404, "This product doesn't run an affiliate program.");
    if (program.creatorId === user.id) throw new HttpError(400, "You can't affiliate your own product.");

    const existing = await db.affiliateLink.findUnique({
      where: { userId_programId: { userId: user.id, programId: program.id } },
    });
    if (existing) {
      return Response.json({ link: { id: existing.id, code: existing.code, clicks: existing.clicks, conversions: existing.conversions } });
    }

    // Prefer a clean slug derived from the user's name, fall back to random
    let code = (user.name || "affiliate")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 12);
    if (code.length < 3) code = generateReferralCode();
    const taken = await db.affiliateLink.findUnique({ where: { code } });
    if (taken) code = `${code}-${generateReferralCode().slice(0, 4)}`;

    const link = await db.affiliateLink.create({
      data: { code, userId: user.id, programId: program.id },
    });
    await notify({
      userId: program.creatorId,
      type: "affiliate_joined",
      title: `New affiliate — ${user.name || user.email}`,
      body: `They're now promoting ${program.product.title} for ${program.commissionBps / 100}% per referred first invoice.`,
      icon: "user-plus",
    });
    return Response.json({ link: { id: link.id, code: link.code, clicks: 0, conversions: 0 } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
