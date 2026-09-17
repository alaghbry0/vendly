import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { QUESTION_INCLUDE, serializeQuestion } from "@/lib/serialize";
import type { CreatorQuestionDTO, QuestionsStatsDTO } from "@/lib/types";

// GET /api/creator/questions — the signed-in creator's Q&A inbox across all
// their products, with inbox stats (computed over ALL their questions,
// ignoring filters). Optional ?status=OPEN|ANSWERED and ?productId= filters.
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const productId = url.searchParams.get("productId");

    const ownedProducts = await db.product.findMany({
      where: { creatorId: user.id },
      select: { id: true },
    });
    if (ownedProducts.length === 0) {
      const empty: QuestionsStatsDTO = { open: 0, answered: 0, totalUpvotes: 0, avgResponseHours: null };
      return Response.json({ questions: [], stats: empty });
    }

    const questions = await db.question.findMany({
      where: { productId: { in: ownedProducts.map((p) => p.id) } },
      include: {
        ...QUESTION_INCLUDE,
        product: { select: { id: true, title: true, coverTheme: true } },
      },
    });

    // stats over ALL the creator's questions (filters only affect the list)
    let responseHoursTotal = 0;
    let responseCount = 0;
    const stats: QuestionsStatsDTO = {
      open: 0,
      answered: 0,
      totalUpvotes: 0,
      avgResponseHours: null,
    };
    for (const q of questions) {
      if (q.status === "ANSWERED") stats.answered += 1;
      else stats.open += 1;
      stats.totalUpvotes += q.votes.length;
      const firstCreatorAnswer = q.answers
        .filter((a) => a.isCreator)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
      if (firstCreatorAnswer) {
        responseHoursTotal += (firstCreatorAnswer.createdAt.getTime() - q.createdAt.getTime()) / 3_600_000;
        responseCount += 1;
      }
    }
    if (responseCount > 0) {
      stats.avgResponseHours = Math.round((responseHoursTotal / responseCount) * 10) / 10;
    }

    const filtered = questions.filter((q) => {
      if ((status === "OPEN" || status === "ANSWERED") && q.status !== status) return false;
      if (productId && q.productId !== productId) return false;
      return true;
    });
    filtered.sort((a, b) => {
      if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
      const byVotes = b.votes.length - a.votes.length;
      if (byVotes !== 0) return byVotes;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const data: CreatorQuestionDTO[] = filtered.map((q) => ({
      ...serializeQuestion(q, user.id),
      product: { id: q.product.id, title: q.product.title, coverTheme: q.product.coverTheme },
    }));
    return Response.json({ questions: data, stats });
  } catch (e) {
    return errorResponse(e);
  }
}
