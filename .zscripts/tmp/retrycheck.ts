import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const d = await db.webhookDelivery.findUnique({ where: { id: "cmudojg20006ek9a9doa38cv1" } });
  console.log("After retry:", d?.status, "attempts:", d?.attempts, "responseCode:", d?.responseCode);
  const audits = await db.auditLog.findMany({ where: { action: "webhook.retry" }, orderBy: { at: "desc" }, take: 2 });
  for (const a of audits) console.log("AUDIT:", a.action, JSON.parse(a.detail || "{}").outcome, "attempt:", JSON.parse(a.detail || "{}").attempt);
}
main().then(() => process.exit(0));
