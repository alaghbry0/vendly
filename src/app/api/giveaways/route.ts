import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { getNow } from "@/lib/clock";
import type { Giveaway, GiveawayEntry, Product, User } from "@prisma/client";

type GiveawayWithIncludes = Giveaway & {
  product: (Product & { creator: User }) | null;
  entries: GiveawayEntry[];
};

// Serializes a giveaway for public/customer consumption. `myEntries` is the
// caller's entry count when signed in (null when not entered).
export function serializeGiveaway(
  g: GiveawayWithIncludes,
  myEntries: number | null,
  myWon: boolean
) {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    prize: g.prize,
    prizeValueCents: g.prizeValueCents,
    coverTheme: g.coverTheme,
    status: g.status as "LIVE" | "ENDED",
    endsAt: g.endsAt.toISOString(),
    winnerCount: g.winnerCount,
    memberBonus: g.memberBonus,
    drawnAt: g.drawnAt ? g.drawnAt.toISOString() : null,
    createdAt: g.createdAt.toISOString(),
    entryCount: g.entries.length,
    product: g.product
      ? {
          id: g.product.id,
          title: g.product.title,
          coverTheme: g.product.coverTheme,
          category: g.product.category,
          creator: {
            id: g.product.creator.id,
            name: g.product.creator.name,
            avatarColor: g.product.creator.avatarColor,
          },
        }
      : null,
    myEntry: myEntries,
    myWin: myWon,
  };
}

// GET /api/giveaways — public marketplace feed: LIVE giveaways first
// (ending soonest), then recently ENDED ones. myEntry/myWin populated for
// signed-in callers.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const userId = req.headers.get("x-user-id") || undefined;
    const productFilter = url.searchParams.get("productId") || undefined;
    const limit = Math.min(Number(url.searchParams.get("limit") || 12), 24);

    const where: Record<string, unknown> = { status: { in: ["LIVE", "ENDED"] } };
    if (productFilter) where.productId = productFilter;

    const giveaways = await db.giveaway.findMany({
      where,
      include: { product: { include: { creator: true } }, entries: true },
      orderBy: [{ status: "desc" }, { endsAt: "asc" }],
      take: limit,
    });

    // sign-in is optional for the public feed
    let me: { id: string } | null = null;
    if (userId) {
      me = await db.user.findUnique({ where: { id: userId }, select: { id: true } });
    }

    const data = giveaways.map((g) => {
      let myEntries: number | null = null;
      let myWon = false;
      if (me) {
        const mine = g.entries.find((e) => e.userId === me!.id);
        if (mine) {
          myEntries = mine.entries;
          myWon = mine.won;
        }
      }
      return serializeGiveaway(g, myEntries, myWon);
    });
    return Response.json({ giveaways: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/giveaways — creator launches a drop.
// body: {title, description, prize, prizeValueCents?, productId?, endsInDays,
//        winnerCount?, memberBonus?, coverTheme?}
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    const prize = String(body.prize || "").trim();
    if (title.length < 3 || title.length > 80) throw new HttpError(400, "Title must be 3–80 characters.");
    if (description.length < 10 || description.length > 600) throw new HttpError(400, "Description must be 10–600 characters.");
    if (prize.length < 3 || prize.length > 200) throw new HttpError(400, "Prize must be 3–200 characters.");

    const endsInDays = Number(body.endsInDays);
    if (!Number.isFinite(endsInDays) || endsInDays < 1 || endsInDays > 30)
      throw new HttpError(400, "End time must be 1–30 days from now.");

    const winnerCount = Math.min(Math.max(Number(body.winnerCount) || 1, 1), 10);
    const memberBonus = Math.min(Math.max(Number(body.memberBonus) ?? 2, 0), 10);
    const prizeValueCents = Math.min(Math.max(Number(body.prizeValueCents) || 0, 0), 10_000_000);
    const coverTheme = String(body.coverTheme || "emerald");

    // optional product tie-in: must be the creator's own
    let productId: string | null = null;
    if (body.productId) {
      productId = String(body.productId);
      const product = await db.product.findUnique({ where: { id: productId } });
      if (!product || product.creatorId !== user.id)
        throw new HttpError(404, "That product isn't yours to promote.");
    }

    const now = await getNow();
    const created = await db.giveaway.create({
      data: {
        creatorId: user.id,
        productId,
        title,
        description,
        prize,
        prizeValueCents,
        coverTheme,
        status: "LIVE",
        endsAt: new Date(now.getTime() + endsInDays * 86400000),
        winnerCount,
        memberBonus,
      },
      include: { product: { include: { creator: true } }, entries: true },
    });
    return Response.json({ giveaway: serializeGiveaway(created, null, false) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
