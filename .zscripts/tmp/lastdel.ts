import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const d = await db.webhookDelivery.findFirst({ where: { eventType: "invoice.paid" }, orderBy: { createdAt: "desc" }, include: { endpoint: true } });
  if (d) console.log("LAST invoice.paid delivery:", d.status, "attempts:", d.attempts, "endpoint:", d.endpoint.name, "| test flag:", JSON.parse(d.payload).data?.test === true);
  const failed = await db.webhookDelivery.findFirst({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, include: { endpoint: true } });
  if (failed) console.log("FAILED delivery for retry:", failed.id, failed.eventType, "endpoint:", failed.endpoint.name, "attempts:", failed.attempts);
}
main().then(() => process.exit(0));
