import { db } from "@/lib/db";
import { getClockState } from "@/lib/clock";
import { errorResponse } from "@/lib/session";
import type { DemoUser } from "@/lib/types";

// GET /api/bootstrap — demo users + clock, called once on app load
export async function GET() {
  try {
    const users = await db.user.findMany({
      orderBy: [{ createdAt: "asc" }],
      include: {
        products: { select: { id: true } },
        subscriptions: { where: { status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } }, select: { id: true } },
      },
    });
    const demoUsers: DemoUser[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role as DemoUser["role"],
      bio: u.bio,
      avatarColor: u.avatarColor,
      discordHandle: u.discordHandle,
      telegramHandle: u.telegramHandle,
      createdAt: u.createdAt.toISOString(),
      productCount: u.products.length,
      activeSubs: u.subscriptions.length,
    }));
    const clock = await getClockState();
    return Response.json({ users: demoUsers, clock });
  } catch (e) {
    return errorResponse(e);
  }
}
