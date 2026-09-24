import { db } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

// POST /api/auth/login { email } — demo login; creates the user if new
export async function POST(req: Request) {
  try {
    // IP-keyed brute-force guard (no user id yet at this point).
    const limited = rateLimit({ req, bucket: "login", max: 20, windowMs: 60_000 });
    if (limited) return limited;
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) throw new HttpError(400, "A valid email is required.");

    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      const name = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const colors = ["emerald", "violet", "rose", "amber", "cyan", "lime", "orange", "teal", "fuchsia"];
      user = await db.user.create({
        data: { email, name, role: "CUSTOMER", avatarColor: colors[Math.floor(Math.random() * colors.length)] },
      });
    }
    return Response.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      bio: user.bio,
      avatarColor: user.avatarColor,
      discordHandle: user.discordHandle,
      telegramHandle: user.telegramHandle,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
