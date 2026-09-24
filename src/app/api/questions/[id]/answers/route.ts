import { db } from "@/lib/db";
import { getNow } from "@/lib/clock";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { notify } from "@/lib/notifications";
import { serializeAnswer } from "@/lib/serialize";

// POST /api/questions/[id]/answers — answer a question (auth). The product's
// creator answering flips the question to ANSWERED; the asker gets notified
// unless they answered it themselves.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const question = await db.question.findUnique({ where: { id }, include: { product: true } });
    if (!question) throw new HttpError(404, "Question not found");

    const body = await req.json().catch(() => ({}));
    const text = String(body.body || "").trim();
    if (text.length < 2 || text.length > 1000) {
      throw new HttpError(400, "Answer must be between 2 and 1000 characters.");
    }

    const isCreator = question.product.creatorId === user.id;
    const answer = await db.answer.create({
      // Platform-clock stamp for consistent relative times in simulated time.
      data: { questionId: id, authorId: user.id, body: text, isCreator, createdAt: await getNow() },
      include: { author: { select: { id: true, name: true, email: true, avatarColor: true } } },
    });

    let status: "OPEN" | "ANSWERED" = question.status === "ANSWERED" ? "ANSWERED" : "OPEN";
    if (isCreator) {
      await db.question.update({ where: { id }, data: { status: "ANSWERED" } });
      status = "ANSWERED";
    }

    if (question.authorId !== user.id) {
      await notify({
        userId: question.authorId,
        type: "question_answered",
        title: `Answered — ${question.product.title}`,
        body: `"${text.slice(0, 90)}${text.length > 90 ? "…" : ""}" — ${user.name || user.email}`,
        icon: "message",
        productId: question.productId,
      });
    }

    return Response.json({ answer: serializeAnswer(answer), question: { id, status } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
