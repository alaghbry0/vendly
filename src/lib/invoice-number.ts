import { db } from "@/lib/db";

// Shared invoice number generator (kept in its own module to avoid cycles).
//
// Atomic & collision-proof: a dedicated Counter row is incremented with a
// single UPDATE (SQLite serializes writers), so a checkout racing the billing
// engine can never mint the same INV-#### twice (the Invoice.number column is
// unique — a collision would throw AFTER the buyer's card was charged).
//
// The counter self-migrates on first use from the highest existing INV-####
// number, so deployments with historical invoices keep a monotonic sequence.
export async function nextInvoiceNumberRef(): Promise<string> {
  let row = await db.counter.findUnique({ where: { id: "invoice" } });
  if (!row) {
    let max = 1000;
    const existing = await db.invoice.findMany({ select: { number: true } });
    for (const inv of existing) {
      const m = /^INV-(\d+)$/.exec(inv.number);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    try {
      row = await db.counter.create({ data: { id: "invoice", value: max } });
    } catch {
      // Another process initialized it first — use theirs.
      row = await db.counter.findUniqueOrThrow({ where: { id: "invoice" } });
    }
  }
  const bumped = await db.counter.update({
    where: { id: "invoice" },
    data: { value: { increment: 1 } },
  });
  return `INV-${bumped.value}`;
}
