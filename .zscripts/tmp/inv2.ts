import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const inv = await db.invoice.findFirst({ where: { whopRef: "pay_g5KZ9xI181NXwn" } });
  console.log(inv?.id, inv?.number, inv?.status, inv?.amountCents);
}
main().then(() => process.exit(0));
