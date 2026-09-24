import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const audits = await db.auditLog.findMany({ where: { action: "webhook.retry" }, orderBy: { at: "desc" }, take: 3 });
  for (const a of audits) { const det = JSON.parse(a.detail || "{}"); console.log("AUDIT:", det.outcome, "attempt:", det.attempt, det.eventType, "endpoint:", det.endpoint); }
}
main().then(() => process.exit(0));
