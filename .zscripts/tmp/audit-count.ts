import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const total = await db.auditLog.count();
  const byAction = await db.auditLog.groupBy({ by: ["action"], _count: true });
  console.log("TOTAL:", total);
  for (const g of byAction) console.log(g.action, g._count);
  const withInv = await db.auditLog.count({ where: { invoiceId: { not: null } } });
  const withSub = await db.auditLog.count({ where: { subscriptionId: { not: null } } });
  console.log("withInvoice:", withInv, "withSub:", withSub);
}
main().then(() => process.exit(0));
