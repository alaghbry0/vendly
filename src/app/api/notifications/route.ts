import { db } from "@/lib/db";
import { errorResponse, requireUser } from "@/lib/session";
import { notificationTarget } from "@/lib/notifications";
import type { NotificationDTO } from "@/lib/types";

// GET /api/notifications — the signed-in user's notification feed + unread count
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const unread = await db.notification.count({ where: { userId: user.id, read: false } });

    const data: NotificationDTO[] = notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      icon: n.icon,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
      target: notificationTarget(n.type),
    }));
    return Response.json({ notifications: data, unread });
  } catch (e) {
    return errorResponse(e);
  }
}
