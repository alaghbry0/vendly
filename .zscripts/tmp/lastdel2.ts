import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const d = await db.webhookDelivery.findFirst({ where: { eventType: "subscription.renewed" }, orderBy: { createdAt: "desc" }, include: { endpoint: true } });
  if (d) console.log("LAST subscription.renewed:", d.status, "attempts:", d.attempts, "endpoint:", d.endpoint.name, "| test:", JSON.parse(d.payload).data?.test === true, "| id:", d.id);
}
main().then(() => process.exit(0));
