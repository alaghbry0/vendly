import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";

// PATCH /api/webhooks/endpoints/[id] — toggle active / update events
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const ep = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!ep || ep.creatorId !== user.id) throw new HttpError(404, "Endpoint not found.");
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
    if (typeof body.name === "string" && body.name.trim().length >= 3) patch.name = body.name.trim();
    if (Array.isArray(body.events)) patch.events = JSON.stringify(body.events.map(String).slice(0, 20));
    await db.webhookEndpoint.update({ where: { id }, data: patch });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

// DELETE /api/webhooks/endpoints/[id]
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const ep = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!ep || ep.creatorId !== user.id) throw new HttpError(404, "Endpoint not found.");
    await db.webhookDelivery.deleteMany({ where: { endpointId: id } });
    await db.webhookEndpoint.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
