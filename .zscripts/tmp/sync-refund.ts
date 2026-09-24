import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const inv = await db.invoice.findFirst({ where: { whopRef: "pay_hDy9RJuIAXnTpB" }, include: { subscription: true } });
  if (!inv) { console.log("no invoice"); return; }
  const now = new Date();
  await db.invoice.update({ where: { id: inv.id }, data: { status: "REFUNDED", refundedCents: 1200, refundedAt: now } });
  const sub = inv.subscription;
  if (sub && sub.status === "ACTIVE") {
    await db.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED", canceledAt: now, cancelAtPeriodEnd: false } });
    await db.accessGrant.updateMany({ where: { userId: sub.userId, productId: sub.productId, status: "SYNCED" }, data: { status: "REVOKED", revokedAt: now } });
    await db.product.update({ where: { id: sub.productId }, data: { membersCount: { decrement: 1 } } });
    console.log("synced: invoice REFUNDED 1200, sub CANCELED, grants revoked");
  } else {
    console.log("synced: invoice REFUNDED 1200 (sub not active)");
  }
}
main().then(() => process.exit(0));
