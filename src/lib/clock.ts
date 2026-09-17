import { db } from "@/lib/db";

// Simulated system clock. When `simulatedNow` is set, the whole platform
// (billing engine, analytics, expiry logic) runs on accelerated time so
// subscription lifecycles can be demoed in minutes.
export async function getNow(): Promise<Date> {
  const clock = await db.systemClock.findUnique({ where: { id: "main" } });
  if (clock?.simulatedNow) return new Date(clock.simulatedNow);
  return new Date();
}

export async function getRealNow(): Promise<Date> {
  return new Date();
}

export async function getClockState() {
  let clock = await db.systemClock.findUnique({ where: { id: "main" } });
  if (!clock) {
    clock = await db.systemClock.create({ data: { id: "main" } });
  }
  const simulated = !!clock.simulatedNow;
  return {
    simulated,
    now: (simulated ? new Date(clock.simulatedNow!) : new Date()).toISOString(),
    label: clock.label || (simulated ? "Simulated" : "Live"),
  };
}

export function addInterval(date: Date, interval: string, count = 1): Date {
  const d = new Date(date);
  if (interval === "year") d.setFullYear(d.getFullYear() + count);
  else d.setMonth(d.getMonth() + count);
  return d;
}
