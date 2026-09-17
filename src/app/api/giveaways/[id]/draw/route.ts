import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { drawGiveawayWinners } from "@/lib/giveaways";

// POST /api/giveaways/[id]/draw — creator draws winners early (closes the
// giveaway). Requires the giveaway to be LIVE and owned by the caller.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const g = await db.giveaway.findUnique({ where: { id } });
    if (!g) throw new HttpError(404, "This giveaway doesn't exist.");
    if (g.creatorId !== user.id) throw new HttpError(403, "You can only draw your own giveaways.");

    const now = await getNow();
    const result = await drawGiveawayWinners(id, now);
    if (!result) throw new HttpError(400, "This giveaway has already ended.");
    return Response.json({ ok: true, winners: result.winners, entryCount: result.entryCount });
  } catch (e) {
    return errorResponse(e);
  }
}
