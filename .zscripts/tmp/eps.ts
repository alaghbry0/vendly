import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const eps = await db.webhookEndpoint.findMany({ select: { id: true, name: true, events: true, isActive: true, creatorId: true } });
  for (const e of eps) console.log(e.creatorId.slice(-6), e.isActive ? "ACTIVE" : "paused", e.name, "|", e.events);
}
main().then(() => process.exit(0));
