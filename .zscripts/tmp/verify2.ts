import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const inv = await db.invoice.findFirst({ where: { whopRef: "pay_g5KZ9xI181NXwn" }, include: { subscription: true } });
  if (!inv) { console.log("none"); return; }
  console.log("INVOICE:", inv.number, inv.status, "refunded:", inv.refundedCents, "/", inv.amountCents);
  const sub = inv.subscription!;
  console.log("SUB:", sub.status);
  const grants = await db.accessGrant.findMany({ where: { userId: sub.userId, productId: sub.productId } });
  console.log("GRANTS:", JSON.stringify(grants.map(g => g.status)));
  const notes = await db.notification.findMany({ where: { userId: inv.userId, type: "invoice_refunded" }, orderBy: { createdAt: "desc" }, take: 1 });
  console.log("NOTIF:", notes[0]?.title);
  const audits = await db.auditLog.findMany({ where: { invoiceId: inv.id }, orderBy: { at: "asc" } });
  for (const a of audits) console.log("AUDIT:", a.action, a.amountCents, JSON.parse(a.detail || "{}").partial === true ? "(partial)" : "");
}
main().then(() => process.exit(0));
