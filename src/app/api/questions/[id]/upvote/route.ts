import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";

// POST /api/questions/[id]/upvote — toggle the caller's upvote (auth).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const question = await db.question.findUnique({ where: { id }, select: { id: true } });
    if (!question) throw new HttpError(404, "Question not found");

    const existing = await db.questionVote.findUnique({
      where: { questionId_userId: { questionId: id, userId: user.id } },
    });
    if (existing) {
      await db.questionVote.delete({ where: { id: existing.id } });
    } else {
      await db.questionVote.create({ data: { questionId: id, userId: user.id } });
    }

    const upvotes = await db.questionVote.count({ where: { questionId: id } });
    return Response.json({ ok: true, upvotes, hasVoted: !existing });
  } catch (e) {
    return errorResponse(e);
  }
}
