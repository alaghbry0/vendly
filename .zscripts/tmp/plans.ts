import { db } from '@/lib/db';
async function main() {
  const p = await db.product.findFirst({ where: { title: "Design Vault" }, include: { plans: true } });
  console.log("PRODUCT:", p?.id, p?.title, "creator:", p?.creatorId);
  p?.plans.forEach(pl => console.log("PLAN:", pl.id, pl.name, pl.priceCents, pl.interval));
  process.exit(0);
}
main();
