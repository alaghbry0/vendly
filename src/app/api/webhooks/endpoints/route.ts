import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { generateWebhookSecret } from "@/lib/licenses";
import type { WebhookEndpointDTO } from "@/lib/types";

// GET /api/webhooks/endpoints — creator's webhook endpoints
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const eps = await db.webhookEndpoint.findMany({
      where: { creatorId: user.id },
      include: { _count: { select: { deliveries: true } } },
      orderBy: { createdAt: "asc" },
    });
    const data: WebhookEndpointDTO[] = eps.map((ep) => ({
      id: ep.id,
      name: ep.name,
      provider: ep.provider,
      url: ep.url,
      secret: ep.secret,
      events: (() => {
        try {
          return JSON.parse(ep.events || "[]");
        } catch {
          return [];
        }
      })(),
      isActive: ep.isActive,
      createdAt: ep.createdAt.toISOString(),
      deliveryCount: ep._count.deliveries,
    }));
    return Response.json({ endpoints: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/webhooks/endpoints — register a new endpoint
// body: { name, provider, url, events[] }
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const url = String(body.url || "").trim();
    const provider = ["DISCORD_BOT", "TELEGRAM_BOT", "GENERIC"].includes(body.provider) ? body.provider : "GENERIC";
    const events = Array.isArray(body.events) ? body.events.map(String).slice(0, 20) : [];

    if (name.length < 3) throw new HttpError(400, "Endpoint name must be at least 3 characters.");
    if (!/^https?:\/\//.test(url)) throw new HttpError(400, "Endpoint URL must start with http(s)://");
    if (events.length === 0) throw new HttpError(400, "Subscribe to at least one event.");

    const ep = await db.webhookEndpoint.create({
      data: {
        creatorId: user.id,
        name,
        provider,
        url,
        secret: generateWebhookSecret(),
        events: JSON.stringify(events),
        isActive: true,
      },
    });
    return Response.json(
      {
        endpoint: {
          id: ep.id,
          name: ep.name,
          provider: ep.provider,
          url: ep.url,
          secret: ep.secret,
          events,
          isActive: ep.isActive,
          createdAt: ep.createdAt.toISOString(),
          deliveryCount: 0,
        },
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
