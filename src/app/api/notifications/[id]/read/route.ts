import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";

// POST /api/notifications/[id]/read — mark one notification read
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const n = await db.notification.findFirst({ where: { id, userId: user.id } });
    if (!n) throw new HttpError(404, "Notification not found.");
    if (!n.read) await db.notification.update({ where: { id }, data: { read: true } });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
