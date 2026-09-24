import { db } from "@/lib/db";
import { signPayload } from "@/lib/licenses";
import { getNow } from "@/lib/clock";

// Event-driven access management: every meaningful subscription event is
// fanned out to the creator's webhook endpoints (Discord bot, Telegram bot,
// generic HTTP). Delivery is simulated: endpoints whose URL contains "fail"
// or "500" return a 500 to demonstrate retries/failures.
// Timestamps use the platform clock so simulated time stays consistent.

export interface WebhookPayload {
  id: string;
  type: string;
  created: string;
  data: Record<string, unknown>;
}

export async function dispatchEvent(
  creatorId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<number> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { creatorId, isActive: true },
  });

  const now = await getNow();
  const payload: WebhookPayload = {
    id: `evt_${Math.random().toString(36).slice(2, 12)}`,
    type: eventType,
    created: now.toISOString(),
    data,
  };
  const body = JSON.stringify(payload, null, 2);

  let dispatched = 0;
  for (const ep of endpoints) {
    let events: string[] = [];
    try {
      events = JSON.parse(ep.events || "[]");
    } catch {
      events = [];
    }
    const subscribed = events.length === 0 || events.includes(eventType) || events.includes("*");
    if (!subscribed) continue;

    // Simulate delivery outcome
    const fails = /fail|500|error/i.test(ep.url);
    const responseCode = fails ? 500 : 200;
    const status = fails ? "FAILED" : "DELIVERED";

    await db.webhookDelivery.create({
      data: {
        endpointId: ep.id,
        eventType,
        payload: body,
        status,
        attempts: 1,
        responseCode,
        signature: signPayload(ep.secret, body),
        createdAt: now,
        deliveredAt: fails ? null : now,
      },
    });
    dispatched++;
  }
  return dispatched;
}

// Provision access: creates AccessGrant rows + dispatches access.granted
// for every provider configured on the product (DISCORD/TELEGRAM/LICENSE/FILE).
export async function grantAccess(
  userId: string,
  productId: string,
  meta: { discordRoleName?: string | null; telegramChannel?: string | null }
): Promise<void> {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return;
  const providers = (product.accessType || "LINK").split(",").map((s) => s.trim()).filter(Boolean);
  const user = await db.user.findUnique({ where: { id: userId } });

  for (const provider of providers) {
    const role =
      provider === "DISCORD"
        ? meta.discordRoleName || product.discordRoleName || "@Member"
        : provider === "TELEGRAM"
          ? meta.telegramChannel || product.telegramChannel || "members"
          : null;

    const existing = await db.accessGrant.findFirst({
      where: { userId, productId, provider, status: { in: ["SYNCED", "PENDING"] } },
    });
    if (!existing) {
      await db.accessGrant.create({
        data: {
          userId,
          productId,
          provider,
          role,
          status: "SYNCED",
          grantedAt: await getNow(),
        },
      });
    }

    await dispatchEvent(product.creatorId, "access.granted", {
      user: { id: userId, email: user?.email, name: user?.name, discord: user?.discordHandle, telegram: user?.telegramHandle },
      product: { id: product.id, title: product.title },
      provider,
      role,
    });
  }
}

export async function revokeAccess(userId: string, productId: string): Promise<void> {
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product) return;
  const grants = await db.accessGrant.findMany({
    where: { userId, productId, status: { in: ["SYNCED", "PENDING"] } },
  });
  for (const g of grants) {
    await db.accessGrant.update({
      where: { id: g.id },
      data: { status: "REVOKED", revokedAt: await getNow() },
    });
  }
  if (grants.length > 0) {
    await dispatchEvent(product.creatorId, "access.revoked", {
      user: { id: userId },
      product: { id: product.id, title: product.title },
      providers: grants.map((g) => g.provider),
    });
  }
}
