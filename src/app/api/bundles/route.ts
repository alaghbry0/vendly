import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { BUNDLE_INCLUDE, bundleSlugify, serializeBundle } from "@/lib/bundles";

// GET /api/bundles — public marketplace feed of active bundles.
export async function GET() {
  try {
    const bundles = await db.bundle.findMany({
      where: { active: true },
      include: BUNDLE_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ bundles: bundles.map((b) => serializeBundle(b)) });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/bundles — creator assembles a bundle of 2–6 of their own products.
// body: { title, description?, discountPct, coverTheme?, items: [{ productId, planId }] }
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const title = String(body.title || "").trim();
    if (title.length < 3 || title.length > 80) throw new HttpError(400, "Title must be 3–80 characters.");
    const description =
      typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

    const discountPct = Number(body.discountPct);
    if (!Number.isInteger(discountPct) || discountPct < 5 || discountPct > 50) {
      throw new HttpError(400, "Bundle discount must be an integer between 5 and 50 percent.");
    }

    const coverTheme = String(body.coverTheme || "emerald");

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length < 2 || rawItems.length > 6) {
      throw new HttpError(400, "A bundle needs exactly 2–6 products.");
    }

    // Validate every item: own product, ACTIVE product, active plan of that
    // product, no duplicates, shared billing interval.
    const seenProducts = new Set<string>();
    let interval: string | null = null;
    const items: { productId: string; planId: string }[] = [];
    for (const raw of rawItems) {
      const productId = String(raw?.productId || "");
      const planId = String(raw?.planId || "");
      const product = await db.product.findUnique({ where: { id: productId } });
      if (!product) throw new HttpError(404, "Product not found.");
      if (product.creatorId !== user.id) throw new HttpError(403, `You don't own ${product.title}.`);
      if (product.status !== "ACTIVE") throw new HttpError(400, `${product.title} is not accepting new members.`);
      if (seenProducts.has(productId)) throw new HttpError(400, "Each product can only appear once in a bundle.");
      const plan = await db.plan.findUnique({ where: { id: planId } });
      if (!plan || plan.productId !== productId) {
        throw new HttpError(400, `The selected plan doesn't belong to ${product.title}.`);
      }
      if (!plan.active) throw new HttpError(400, `${product.title} — ${plan.name} is not active.`);
      if (interval === null) interval = plan.interval;
      else if (plan.interval !== interval) {
        throw new HttpError(400, "All plans in a bundle must share the same billing interval.");
      }
      seenProducts.add(productId);
      items.push({ productId, planId });
    }

    // unique slug (append -2, -3… on collision)
    const slugBase = bundleSlugify(title);
    let slug = slugBase;
    let n = 1;
    while (await db.bundle.findUnique({ where: { slug } })) slug = `${slugBase}-${++n}`;

    const created = await db.bundle.create({
      data: {
        creatorId: user.id,
        slug,
        title,
        description,
        discountPct,
        coverTheme,
        active: true,
        items: {
          create: items.map((it, i) => ({
            productId: it.productId,
            planId: it.planId,
            sortOrder: i,
          })),
        },
      },
      include: BUNDLE_INCLUDE,
    });
    return Response.json({ bundle: serializeBundle(created) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
