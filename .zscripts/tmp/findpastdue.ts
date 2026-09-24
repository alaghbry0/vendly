import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const subs = await db.subscription.findMany({
  where: { status: "PAST_DUE" },
  include: { plan: { include: { product: true } }, paymentMethod: true },
});
for (const s of subs) {
  console.log("PAST_DUE:", s.id, "| user:", s.userId, "| gateway:", s.gateway, "| attempts:", s.dunningAttempts, "| pm:", s.paymentMethod ? `${s.paymentMethod.brand} ••${s.paymentMethod.last4}` : "none", "|", s.plan.product.title);
}
console.log("total:", subs.length);
await db.$disconnect();
