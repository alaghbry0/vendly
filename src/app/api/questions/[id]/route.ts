import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";

// DELETE /api/questions/[id] — remove a question (auth). Allowed for the
// question's author or the product's creator; answers + votes cascade.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const question = await db.question.findUnique({ where: { id }, include: { product: true } });
    if (!question) throw new HttpError(404, "Question not found");

    if (question.authorId !== user.id && question.product.creatorId !== user.id) {
      throw new HttpError(403, "Only the question author or the product creator can delete this question.");
    }

    await db.$transaction([
      db.answer.deleteMany({ where: { questionId: id } }),
      db.questionVote.deleteMany({ where: { questionId: id } }),
      db.question.delete({ where: { id } }),
    ]);

    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
