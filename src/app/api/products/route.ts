import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { serializeProductCard } from "@/lib/serialize";
import type { Plan } from "@prisma/client";

// GET /api/products?q=&category=&sort= — marketplace catalog
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").toLowerCase().trim();
    const category = url.searchParams.get("category") || "";
    const sort = url.searchParams.get("sort") || "featured";
    const creatorId = url.searchParams.get("creatorId") || "";

    const products = await db.product.findMany({
      where: {
        status: "ACTIVE",
        ...(category ? { category } : {}),
        ...(creatorId ? { creatorId } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { tagline: { contains: q } },
                { description: { contains: q } },
              ],
            }
          : {}),
      },
      include: { creator: true, plans: true },
    });

    let cards = products.map(serializeProductCard);
    if (sort === "members") cards = cards.sort((a, b) => b.membersCount - a.membersCount);
    else if (sort === "rating") cards = cards.sort((a, b) => b.rating - a.rating);
    else if (sort === "price") cards = cards.sort((a, b) => (a.fromPriceCents ?? 0) - (b.fromPriceCents ?? 0));
    else cards = cards.sort((a, b) => Number(b.featured) - Number(a.featured) || b.membersCount - a.membersCount);

    return Response.json({ products: cards });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/products — create product with tiers (creator only)
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const title = String(body.title || "").trim();
    const description = String(body.description || "").trim();
    const category = String(body.category || "OTHER");
    const accessType = Array.isArray(body.accessType) ? body.accessType.filter(Boolean).join(",") : "LINK";
    const plansInput = Array.isArray(body.plans) ? body.plans : [];

    if (title.length < 3) throw new HttpError(400, "Product title must be at least 3 characters.");
    if (description.length < 10) throw new HttpError(400, "Description must be at least 10 characters.");
    const validPlans = plansInput.filter(
      (p: any) => p && String(p.name || "").trim() && Number(p.priceCents) > 0
    );
    if (validPlans.length === 0) throw new HttpError(400, "At least one pricing tier with a name and price is required.");

    const slugBase = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
    let slug = slugBase;
    let n = 1;
    while (await db.product.findUnique({ where: { slug } })) slug = `${slugBase}-${++n}`;

    const themes = ["emerald", "violet", "rose", "amber", "cyan", "lime", "orange", "teal", "fuchsia"];
    const product = await db.product.create({
      data: {
        creatorId: user.id,
        slug,
        title,
        tagline: String(body.tagline || "").slice(0, 120) || null,
        description,
        category,
        coverTheme: themes[slug.length % themes.length],
        accessType,
        discordRoleName: body.discordRoleName ? String(body.discordRoleName) : null,
        telegramChannel: body.telegramChannel ? String(body.telegramChannel) : null,
        status: "ACTIVE",
      },
    });

    let sortOrder = 1;
    for (const p of validPlans) {
      await db.plan.create({
        data: {
          productId: product.id,
          name: String(p.name).slice(0, 40),
          description: p.description ? String(p.description).slice(0, 120) : null,
          priceCents: Math.round(Number(p.priceCents)),
          interval: p.interval === "year" ? "year" : "month",
          trialDays: Math.max(0, Math.min(30, Number(p.trialDays) || 0)),
          badge: p.badge ? String(p.badge).slice(0, 24) : null,
          features: JSON.stringify(Array.isArray(p.features) ? p.features.map(String).slice(0, 8) : []),
          sortOrder: sortOrder++,
        } as Plan,
      });
    }

    const created = await db.product.findUnique({
      where: { id: product.id },
      include: { creator: true, plans: true },
    });
    return Response.json({ product: created ? serializeProductCard(created) : null }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
