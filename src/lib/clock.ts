import { db } from "@/lib/db";

// Platform clock. When `simulatedNow` is set the whole platform (billing
// engine, analytics, expiry logic, notification timestamps) runs on a time
// machine: the offset captured at advance time keeps ticking in lock-step
// with real time, so a "+30 days" jump stays exactly 30 days ahead.
//
//   platformNow = simulatedNow + (realNow - simulatedSetAt)
//
// All domain writes (invoices, notifications, reviews, …) must stamp with
// getNow() — never bare `new Date()` — so every displayed time is consistent
// inside the simulated frame.
export async function getNow(): Promise<Date> {
  const clock = await db.systemClock.findUnique({ where: { id: "main" } });
  if (clock?.simulatedNow) {
    const setAt = clock.simulatedSetAt ?? clock.updatedAt; // legacy rows: frozen
    const elapsed = Date.now() - setAt.getTime();
    return new Date(clock.simulatedNow.getTime() + Math.max(0, elapsed));
  }
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
  const now = simulated
    ? new Date(
        clock.simulatedNow!.getTime() +
          Math.max(0, Date.now() - (clock.simulatedSetAt ?? clock.updatedAt).getTime())
      )
    : new Date();
  return {
    simulated,
    now: now.toISOString(),
    label: clock.label || (simulated ? "Simulated" : "Live"),
  };
}

export function addInterval(date: Date, interval: string, count = 1): Date {
  const d = new Date(date);
  if (interval === "year") d.setFullYear(d.getFullYear() + count);
  else if (interval === "week") d.setDate(d.getDate() + 7 * count);
  else if (interval === "day") d.setDate(d.getDate() + count);
  else if (interval === "month") {
    // Clamp to the last day of the target month (Jan 31 + 1 month → Feb 28/29,
    // never a JS rollover to Mar 3) — standard billing-engine behavior so
    // month-end renewal anchors don't drift forward period after period.
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + count);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  } else d.setMonth(d.getMonth() + count);
  return d;
}

// Human label for a clock offset (e.g. "+30d", "+36h").
export function offsetLabel(offsetMs: number): string {
  const days = Math.floor(offsetMs / 86400000);
  if (days >= 1) return `+${days}d`;
  const hours = Math.round((offsetMs % 86400000) / 3600000);
  return `+${Math.max(1, hours)}h`;
}
