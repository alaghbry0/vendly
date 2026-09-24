// DB query helper for E2E assertions — usage: bunx tsx dbq.ts <json-action>
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "sub") {
    const sub = await db.subscription.findUnique({ where: { id: arg }, include: { invoices: true, licenses: true } });
    if (!sub) { console.log("SUB NOT FOUND"); return; }
    console.log("SUB_STATUS:", sub.status, "| gateway:", sub.gateway, "| dunningAttempts:", sub.dunningAttempts, "| cancelAtPeriodEnd:", sub.cancelAtPeriodEnd);
    console.log("PERIOD:", sub.currentPeriodStart.toISOString().slice(0,10), "→", sub.currentPeriodEnd.toISOString().slice(0,10));
    console.log("INVOICES total:", sub.invoices.length, "PAID:", sub.invoices.filter(i=>i.status==="PAID").length, "FAILED:", sub.invoices.filter(i=>i.status==="FAILED").length);
    console.log("FAILED_AT:", JSON.stringify(sub.invoices.filter(i=>i.status==="FAILED").map(i=>i.createdAt.toISOString().slice(0,10))));
    console.log("INVOICE_NUMBERS:", JSON.stringify(sub.invoices.map(i=>`${i.number}:${i.amountCents}:${i.status}`).sort()));
    console.log("LICENSES:", JSON.stringify(sub.licenses.map(l=>l.status)));
    const notes = await db.notification.findMany({ where: { userId: sub.userId, type: { in: ["payment_failed","subscription_canceled","invoice_paid"] } }, orderBy: { createdAt: "asc" } });
    console.log("NOTIFICATIONS:", JSON.stringify(notes.map(n=>`${n.type}@${n.createdAt.toISOString().slice(0,10)}`)));
  }
  if (cmd === "flip-card") {
    // flip-card <subId> <last4>  (argv: [node, script, cmd, subId, last4])
    const last4 = process.argv[4] || "0002";
    const sub = await db.subscription.findUnique({ where: { id: arg } });
    if (sub?.paymentMethodId) {
      await db.paymentMethod.update({ where: { id: sub.paymentMethodId }, data: { last4 } });
      console.log("CARD_FLIPPED to", last4);
    } else console.log("NO PM");
  }
  if (cmd === "set-period-end") {
    // set-period-end <subId> <iso>
    // argv: [bun, script, cmd, subId, isoEnd, isoStart?] — R22 fixed the
    // off-by-one (the ISO was reading the subId and producing Invalid Date).
    const isoEnd = process.argv[4];
    const isoStart = process.argv[5] || isoEnd;
    await db.subscription.update({ where: { id: arg }, data: { currentPeriodEnd: new Date(isoEnd), currentPeriodStart: new Date(isoStart) } });
    const s = await db.subscription.findUnique({ where: { id: arg } });
    console.log("PERIOD_END_SET:", s?.currentPeriodEnd.toISOString());
  }
  if (cmd === "invoice-dupes") {
    const all = await db.invoice.findMany({ select: { number: true } });
    const seen = new Set<string>(); const dupes: string[] = [];
    for (const i of all) { if (seen.has(i.number)) dupes.push(i.number); seen.add(i.number); }
    console.log("TOTAL_INVOICES:", all.length, "| DUPLICATE_NUMBERS:", JSON.stringify(dupes));
    const nums = all.map(i=>parseInt(i.number.replace("INV-",""),10)).filter(n=>!isNaN(n)).sort((a,b)=>a-b);
    console.log("MONOTONIC:", nums.every((n,idx)=>idx===0||n>nums[idx-1]) ? "YES" : "NO", "| range:", nums[0], "→", nums[nums.length-1]);
  }
  if (cmd === "clock") {
    const c = await db.systemClock.findUnique({ where: { id: "main" } });
    console.log("CLOCK_LABEL:", c?.label);
  }
  await db.$disconnect();
}
main().catch(e => { console.error(e.message); process.exit(1); });
