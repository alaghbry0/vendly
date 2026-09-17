import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import { enterGiveaway } from "@/lib/giveaways";

// POST /api/giveaways/[id]/enter — enter a live drop (idempotent).
// Active members of the linked product earn bonus entries automatically.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const now = await getNow();
    const result = await enterGiveaway(user.id, id, now);
    if (!result.ok) throw new HttpError(400, result.error);
    return Response.json({ ok: true, entries: result.entries, bonus: result.bonus });
  } catch (e) {
    return errorResponse(e);
  }
}
