import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const users = await db.user.findMany({ select: { id: true, email: true, name: true, role: true } });
  users.forEach(u => console.log("USER:", u.id, u.email, u.role, u.name));
  const plans = await db.plan.findMany({ select: { id: true, name: true, priceCents: true, interval: true, trialDays: true, active: true, product: { select: { title: true, slug: true, status: true, creator: { select: { email: true } } } } }, orderBy: { priceCents: "asc" } });
  plans.forEach(p => console.log("PLAN:", p.id, p.name, "$" + (p.priceCents/100).toFixed(2), p.interval, "trial:" + p.trialDays, "active:" + p.active, "|", p.product.title, `(${p.product.slug})`, p.product.status, "by", p.product.creator.email));
}
main().then(() => process.exit(0));
