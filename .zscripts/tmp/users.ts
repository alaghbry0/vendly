import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const users = await db.user.findMany({ select: { id: true, email: true, role: true }, orderBy: { id: "asc" } });
  for (const u of users) console.log(u.role.padEnd(10), u.id, u.email);
}
main().then(() => process.exit(0));
