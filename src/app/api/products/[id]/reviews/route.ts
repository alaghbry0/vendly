import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { notify } from "@/lib/notifications";
import { getNow } from "@/lib/clock";

// POST /api/products/[id]/reviews — leave a review (requires access)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const product = await db.product.findUnique({ where: { id } });
    if (!product) throw new HttpError(404, "Product not found");

    const body = await req.json().catch(() => ({}));
    const rating = Math.max(1, Math.min(5, Number(body.rating) || 5));
    const comment = String(body.comment || "").trim();
    if (comment.length < 4) throw new HttpError(400, "Review comment must be at least 4 characters.");

    const review = await db.review.create({
      // Platform-clock stamp — relative times stay consistent in simulated time.
      data: { productId: id, userId: user.id, authorName: user.name || user.email, rating, comment, createdAt: await getNow() },
    });

    // recompute rating
    const agg = await db.review.aggregate({ where: { productId: id }, _avg: { rating: true }, _count: true });
    await db.product.update({
      where: { id },
      data: { rating: Math.round((agg._avg.rating || 5) * 10) / 10, reviewCount: agg._count },
    });

    await notify({
      userId: product.creatorId,
      type: "review_new",
      title: `New ${"★".repeat(rating)} review — ${product.title}`,
      body: `"${comment.slice(0, 90)}${comment.length > 90 ? "..." : ""}" — ${user.name || user.email}`,
      icon: "star",
    });

    return Response.json({
      review: {
        id: review.id,
        authorName: review.authorName,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt.toISOString(),
      },
    }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
