import { db } from "@/lib/db";
import { errorResponse, getSessionUser, HttpError, requireUser } from "@/lib/session";
import { notify } from "@/lib/notifications";
import { QUESTION_INCLUDE, serializeQuestion } from "@/lib/serialize";

// GET /api/products/[id]/questions — public Q&A feed for a product.
// Sorted OPEN first, then upvotes desc, then newest; max 30.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const product = await db.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) throw new HttpError(404, "Product not found");

    const viewer = await getSessionUser(req);
    const questions = await db.question.findMany({
      where: { productId: id },
      include: QUESTION_INCLUDE,
    });
    const sorted = questions
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
        const byVotes = b.votes.length - a.votes.length;
        if (byVotes !== 0) return byVotes;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, 30);

    return Response.json({ questions: sorted.map((q) => serializeQuestion(q, viewer?.id ?? null)) });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/products/[id]/questions — ask a question (auth). The product's
// own creator can't ask on their own product.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new HttpError(404, "Product not found");
    if (product.creatorId === user.id) throw new HttpError(400, "You can't ask on your own product.");

    const body = await req.json().catch(() => ({}));
    const text = String(body.body || "").trim();
    if (text.length < 5 || text.length > 500) {
      throw new HttpError(400, "Question must be between 5 and 500 characters.");
    }

    const question = await db.question.create({
      data: { productId: id, authorId: user.id, body: text },
      include: QUESTION_INCLUDE,
    });

    await notify({
      userId: product.creatorId,
      type: "question_asked",
      title: `New question — ${product.title}`,
      body: `"${text.slice(0, 90)}${text.length > 90 ? "…" : ""}" — ${user.name || user.email}`,
      icon: "message",
    });

    return Response.json({ question: serializeQuestion(question, user.id) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
