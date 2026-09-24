import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { BUNDLE_INCLUDE, serializeBundle } from "@/lib/bundles";

// GET /api/bundles/creator — the signed-in creator's bundles (active +
// inactive) with real performance stats.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const bundles = await db.bundle.findMany({
      where: { creatorId: user.id },
      include: { ...BUNDLE_INCLUDE, purchases: { select: { totalCents: true } } },
      orderBy: { createdAt: "desc" },
    });

    const data = await Promise.all(
      bundles.map(async (b) => {
        // distinct buyers holding a live subscription from this bundle
        // (each purchase provisions one sub per product — dedupe by user)
        const members = await db.subscription.findMany({
          where: { bundleId: b.id, status: { in: ["ACTIVE", "TRIALING"] } },
          select: { userId: true },
          distinct: ["userId"],
        });
        return serializeBundle(b, {
          salesCount: b.purchases.length,
          revenueCents: b.purchases.reduce((s, p) => s + p.totalCents, 0),
          membersCount: members.length,
        });
      })
    );
    return Response.json({ bundles: data });
  } catch (e) {
    return errorResponse(e);
  }
}
