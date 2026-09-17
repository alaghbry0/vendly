import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { serializeGiveaway } from "../route";

// GET /api/giveaways/creator — the signed-in creator's giveaways with
// performance stats, winners and a recent-entries feed.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const giveaways = await db.giveaway.findMany({
      where: { creatorId: user.id },
      include: {
        product: { include: { creator: true } },
        entries: { include: { user: true }, orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    const data = giveaways.map((g) => {
      const row = (e: (typeof g.entries)[number]) => ({
        id: e.id,
        entries: e.entries,
        won: e.won,
        createdAt: e.createdAt.toISOString(),
        entrant: {
          id: e.user.id,
          name: e.user.name,
          email: e.user.email,
          avatarColor: e.user.avatarColor,
        },
      });
      return {
        ...serializeGiveaway(g, null, false),
        winners: g.entries.filter((e) => e.won).map(row),
        recentEntries: g.entries.slice(0, 8).map(row),
        totalEntriesWeighted: g.entries.reduce((s, e) => s + e.entries, 0),
      };
    });
    return Response.json({ giveaways: data });
  } catch (e) {
    return errorResponse(e);
  }
}
