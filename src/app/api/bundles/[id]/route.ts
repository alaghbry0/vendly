import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { BUNDLE_INCLUDE, serializeBundle } from "@/lib/bundles";

// GET /api/bundles/[id] — single bundle. Public when active; the creator can
// also fetch their own inactive bundles.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const bundle = await db.bundle.findUnique({ where: { id }, include: BUNDLE_INCLUDE });
    if (!bundle) throw new HttpError(404, "Bundle not found.");
    const requesterId = req.headers.get("x-user-id");
    if (!bundle.active && requesterId !== bundle.creatorId) throw new HttpError(404, "Bundle not found.");
    return Response.json({ bundle: serializeBundle(bundle) });
  } catch (e) {
    return errorResponse(e);
  }
}

// PATCH /api/bundles/[id] — creator-owned metadata update (items are fixed at
// creation). body: { title?, description?, discountPct?, active?, coverTheme? }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const bundle = await db.bundle.findUnique({ where: { id } });
    if (!bundle) throw new HttpError(404, "Bundle not found.");
    if (bundle.creatorId !== user.id) throw new HttpError(403, "You don't own this bundle.");

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (title.length < 3 || title.length > 80) throw new HttpError(400, "Title must be 3–80 characters.");
      patch.title = title;
    }
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (body.discountPct !== undefined) {
      const discountPct = Number(body.discountPct);
      if (!Number.isInteger(discountPct) || discountPct < 5 || discountPct > 50) {
        throw new HttpError(400, "Bundle discount must be an integer between 5 and 50 percent.");
      }
      patch.discountPct = discountPct;
    }
    if (typeof body.active === "boolean") patch.active = body.active;
    if (typeof body.coverTheme === "string" && body.coverTheme) patch.coverTheme = body.coverTheme;

    const updated = await db.bundle.update({ where: { id }, data: patch, include: BUNDLE_INCLUDE });
    return Response.json({ bundle: serializeBundle(updated) });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/bundles/[id] — creator-owned. Bundles with past purchases can't
// be deleted (history integrity) — deactivate instead.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const bundle = await db.bundle.findUnique({ where: { id } });
    if (!bundle) throw new HttpError(404, "Bundle not found.");
    if (bundle.creatorId !== user.id) throw new HttpError(403, "You don't own this bundle.");

    const purchases = await db.bundlePurchase.count({ where: { bundleId: id } });
    if (purchases > 0) {
      throw new HttpError(409, "This bundle has past purchases — deactivate it instead.");
    }

    await db.bundle.delete({ where: { id } }); // items cascade
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
