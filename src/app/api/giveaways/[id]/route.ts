import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { serializeGiveaway } from "../route";

// PATCH /api/giveaways/[id] — creator edits a LIVE giveaway (title,
// description, prize, end date) or cancels it ({cancel: true} ends without
// drawing winners).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const g = await db.giveaway.findUnique({
      where: { id },
      include: { product: { include: { creator: true } }, entries: true },
    });
    if (!g) throw new HttpError(404, "This giveaway doesn't exist.");
    if (g.creatorId !== user.id) throw new HttpError(403, "You can only edit your own giveaways.");

    const now = await getNow();

    // Cancel path: end the drop without drawing.
    if (body.cancel) {
      if (g.status !== "LIVE") throw new HttpError(400, "This giveaway already ended.");
      const canceled = await db.giveaway.update({
        where: { id },
        data: { status: "ENDED", drawnAt: now },
        include: { product: { include: { creator: true } }, entries: true },
      });
      return Response.json({ giveaway: serializeGiveaway(canceled, null, false) });
    }

    if (g.status !== "LIVE") throw new HttpError(400, "Ended giveaways can't be edited.");

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (title.length < 3 || title.length > 80) throw new HttpError(400, "Title must be 3–80 characters.");
      data.title = title;
    }
    if (body.description !== undefined) {
      const description = String(body.description).trim();
      if (description.length < 10 || description.length > 600)
        throw new HttpError(400, "Description must be 10–600 characters.");
      data.description = description;
    }
    if (body.prize !== undefined) {
      const prize = String(body.prize).trim();
      if (prize.length < 3 || prize.length > 200) throw new HttpError(400, "Prize must be 3–200 characters.");
      data.prize = prize;
    }
    if (body.endsInDays !== undefined) {
      const endsInDays = Number(body.endsInDays);
      if (!Number.isFinite(endsInDays) || endsInDays < 1 || endsInDays > 30)
        throw new HttpError(400, "End time must be 1–30 days from now.");
      data.endsAt = new Date(now.getTime() + endsInDays * 86400000);
    }
    if (body.winnerCount !== undefined) {
      data.winnerCount = Math.min(Math.max(Number(body.winnerCount) || 1, 1), 10);
    }
    if (body.memberBonus !== undefined) {
      data.memberBonus = Math.min(Math.max(Number(body.memberBonus) || 0, 0), 10);
    }

    const updated = await db.giveaway.update({
      where: { id },
      data,
      include: { product: { include: { creator: true } }, entries: true },
    });
    return Response.json({ giveaway: serializeGiveaway(updated, null, false) });
  } catch (e) {
    return errorResponse(e);
  }
}
