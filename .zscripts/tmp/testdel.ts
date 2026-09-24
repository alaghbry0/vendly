import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const all = await db.webhookDelivery.findMany({ include: { endpoint: true }, orderBy: { createdAt: "desc" }, take: 60 });
  const tests = all.filter(d => { try { return JSON.parse(d.payload).data?.test === true; } catch { return false; } });
  for (const t of tests) console.log("TEST delivery:", t.id, t.eventType, t.status, "attempts:", t.attempts, "endpoint:", t.endpoint.name, "at:", t.createdAt.toISOString());
}
main().then(() => process.exit(0));
