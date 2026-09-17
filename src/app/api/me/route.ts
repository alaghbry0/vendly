import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";

// GET /api/me — current session user
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    return Response.json(user);
  } catch (e) {
    return errorResponse(e);
  }
}

// PATCH /api/me — update profile (name, discord/telegram handles, bio, role)
export async function PATCH(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, string | null> = {};
    if (typeof body.name === "string") patch.name = body.name.slice(0, 80) || null;
    if (typeof body.discordHandle === "string") patch.discordHandle = body.discordHandle.trim().slice(0, 40) || null;
    if (typeof body.telegramHandle === "string") patch.telegramHandle = body.telegramHandle.trim().slice(0, 40) || null;
    if (typeof body.bio === "string") patch.bio = body.bio.slice(0, 400);
    if (body.role === "CREATOR" || body.role === "CUSTOMER") patch.role = body.role;

    const updated = await db.user.update({ where: { id: user.id }, data: patch });
    if (!updated) throw new HttpError(404, "User not found");
    return Response.json({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      bio: updated.bio,
      avatarColor: updated.avatarColor,
      discordHandle: updated.discordHandle,
      telegramHandle: updated.telegramHandle,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
