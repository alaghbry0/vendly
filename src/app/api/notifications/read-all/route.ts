import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";

// POST /api/notifications/read-all — mark everything read
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    await db.notification.updateMany({ where: { userId: user.id, read: false }, data: { read: true } });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
