import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const inv = await db.invoice.findFirst({ where: { whopRef: "pay_hDy9RJuIAXnTpB" }, include: { subscription: true, user: true } });
  if (!inv) { console.log("NO INVOICE for pay_hDy9RJuIAXnTpB"); return; }
  console.log("INVOICE:", inv.number, inv.status, "amount:", inv.amountCents, "refundedCents:", inv.refundedCents);
  console.log("SUB:", inv.subscription?.status, "gateway:", inv.subscription?.gateway, "periodEnd:", inv.subscription?.currentPeriodEnd.toISOString().slice(0, 10));
  console.log("BUYER:", inv.user.email);
  const pm = inv.subscription?.paymentMethodId ? await db.paymentMethod.findUnique({ where: { id: inv.subscription!.paymentMethodId } }) : null;
  console.log("PM:", pm ? `${pm.brand} ••${pm.last4} whopPayt=${pm.whopPaymentMethodId?.slice(0,12)} mber=${pm.whopMemberId?.slice(0,12)}` : "none");
  const audits = await db.auditLog.findMany({ where: { invoiceId: inv.id } });
  for (const a of audits) console.log("AUDIT:", a.action, "amount:", a.amountCents, "actor:", a.actorId.slice(0, 8), a.detail?.slice(0, 90));
}
main().then(() => process.exit(0));
