import { db } from "@/lib/db";
import { getNow } from "@/lib/clock";
import { errorResponse, requireUser } from "@/lib/session";
import type { WebhookDeliveryDTO } from "@/lib/types";

// GET /api/webhooks/deliveries?endpointId=&status=&type= — delivery log
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const url = new URL(req.url);
    const endpointId = url.searchParams.get("endpointId");
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");

    const myEndpoints = await db.webhookEndpoint.findMany({ where: { creatorId: user.id } });
    const myIds = myEndpoints.map((e) => e.id);

    const deliveries = await db.webhookDelivery.findMany({
      where: {
        endpointId: { in: myIds },
        ...(endpointId ? { endpointId } : {}),
        ...(status ? { status } : {}),
        ...(type ? { eventType: type } : {}),
      },
      include: { endpoint: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const data: WebhookDeliveryDTO[] = deliveries.map((d) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(d.payload || "{}");
      } catch {
        payload = {};
      }
      return {
        id: d.id,
        eventType: d.eventType,
        status: d.status,
        attempts: d.attempts,
        responseCode: d.responseCode,
        createdAt: d.createdAt.toISOString(),
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
        payload,
        endpoint: { id: d.endpoint.id, name: d.endpoint.name, provider: d.endpoint.provider },
      };
    });

    return Response.json({ deliveries: data, now: (await getNow()).toISOString() });
  } catch (e) {
    return errorResponse(e);
  }
}
