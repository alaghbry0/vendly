import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const invs = await db.invoice.findMany({ where: { status: "PAID" }, include: { subscription: { include: { plan: { include: { product: true } } } } }, orderBy: { createdAt: "desc" }, take: 6 });
  for (const i of invs) console.log(i.id, i.number, i.amountCents, "creator:", i.subscription?.plan.product.creatorId?.slice(-6), "product:", i.subscription?.plan.product.title);
}
main().then(() => process.exit(0));
