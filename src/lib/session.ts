import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/types";

// Lightweight demo session: the client sends `x-user-id` on every request.
// In production this would be replaced by a real auth provider session.
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionUser["role"],
    bio: user.bio,
    avatarColor: user.avatarColor,
    discordHandle: user.discordHandle,
    telegramHandle: user.telegramHandle,
    createdAt: user.createdAt.toISOString(),
  };
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw new HttpError(401, "Not signed in — pick a demo account first.");
  return user;
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  console.error("[api]", e);
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
