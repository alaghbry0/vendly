import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { serializeGiveaway } from "../route";

// GET /api/giveaways/mine — the signed-in customer's giveaway entries
// (active drops first, then ended ones; wins flagged).
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const entries = await db.giveawayEntry.findMany({
      where: { userId: user.id },
      include: { giveaway: { include: { product: { include: { creator: true } }, entries: true } } },
      orderBy: { createdAt: "desc" },
    });

    const data = entries.map((e) => ({
      id: e.id,
      entries: e.entries,
      won: e.won,
      createdAt: e.createdAt.toISOString(),
      giveaway: serializeGiveaway(e.giveaway, e.entries, e.won),
    }));
    return Response.json({ entries: data });
  } catch (e) {
    return errorResponse(e);
  }
}
