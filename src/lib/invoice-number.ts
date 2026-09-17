import { db } from "@/lib/db";

// Shared invoice number generator (kept in its own module to avoid cycles).
export async function nextInvoiceNumberRef(): Promise<string> {
  const count = await db.invoice.count();
  return `INV-${(1001 + count).toString()}`;
}
