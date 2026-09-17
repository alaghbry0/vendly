import { db } from "@/lib/db";
import { notify } from "@/lib/notifications";

// ============ Giveaways & drops engine ============
// Creators run prize drops to grow their audience: customers enter for a
// chance to win, active members of the linked product earn bonus entries.
// Winners are drawn when the giveaway's end time passes — the billing
// engine's time machine closes every expired giveaway automatically — or
// creators can draw early.

export interface DrawResult {
  winners: { userId: string; name: string | null; email: string }[];
  entryCount: number;
}

// Weighted random draw: each entrant's odds scale with their entry count
// (members with bonus entries have proportionally higher chances).
function pickWeighted<T>(pool: T[], weight: (t: T) => number, count: number): T[] {
  const items = [...pool];
  const picked: T[] = [];
  while (picked.length < count && items.length > 0) {
    const total = items.reduce((s, i) => s + Math.max(weight(i), 1), 0);
    let roll = Math.random() * total;
    let idx = 0;
    for (; idx < items.length; idx++) {
      roll -= Math.max(weight(items[idx]), 1);
      if (roll <= 0) break;
    }
    if (idx >= items.length) idx = items.length - 1;
    picked.push(items[idx]);
    items.splice(idx, 1);
  }
  return picked;
}

// Draws winners for a LIVE giveaway, marks entries won, notifies everyone.
export async function drawGiveawayWinners(giveawayId: string, now: Date): Promise<DrawResult | null> {
  const g = await db.giveaway.findUnique({
    where: { id: giveawayId },
    include: { entries: { include: { user: true } }, product: true },
  });
  if (!g || g.status !== "LIVE") return null;

  const winners = pickWeighted(g.entries, (e) => e.entries, g.winnerCount);
  const winnerIds = new Set(winners.map((w) => w.userId));

  await db.giveaway.update({
    where: { id: g.id },
    data: { status: "ENDED", drawnAt: now },
  });
  for (const w of winners) {
    await db.giveawayEntry.update({
      where: { giveawayId_userId: { giveawayId: g.id, userId: w.userId } },
      data: { won: true },
    });
    await notify({
      userId: w.userId,
      type: "giveaway_won",
      title: `You won — ${g.title} 🎉`,
      body: `Your prize: ${g.prize}. The creator will be in touch with delivery details.`,
      icon: "gift",
    });
  }
  await notify({
    userId: g.creatorId,
    type: "giveaway_ended",
    title: `Giveaway ended — ${g.title}`,
    body: `${g.entries.length} entr${g.entries.length === 1 ? "y" : "ies"} · ${winners.length} winner${winners.length === 1 ? "" : "s"} drawn${g.product ? ` · ${g.product.title}` : ""}`,
    icon: "gift",
  });

  return {
    winners: winners.map((w) => ({ userId: w.userId, name: w.user.name, email: w.user.email })),
    entryCount: g.entries.length,
  };
}

// Billing-run hook: closes every LIVE giveaway whose end time has passed.
// Returns how many giveaways were drawn.
export async function closeExpiredGiveaways(now: Date): Promise<number> {
  const expired = await db.giveaway.findMany({
    where: { status: "LIVE", endsAt: { lte: now } },
    select: { id: true },
  });
  for (const g of expired) {
    await drawGiveawayWinners(g.id, now);
  }
  return expired.length;
}

// Enters a user into a LIVE giveaway (idempotent). Active members of the
// linked product receive the creator-configured bonus entries.
export async function enterGiveaway(
  userId: string,
  giveawayId: string,
  now: Date
): Promise<{ ok: true; entries: number; bonus: boolean } | { ok: false; error: string }> {
  const g = await db.giveaway.findUnique({
    where: { id: giveawayId },
    include: { product: true },
  });
  if (!g) return { ok: false, error: "This giveaway doesn't exist." };
  if (g.status !== "LIVE") return { ok: false, error: "This giveaway has already ended." };
  if (g.endsAt.getTime() <= now.getTime()) return { ok: false, error: "This giveaway has already ended." };
  if (g.creatorId === userId) return { ok: false, error: "You can't enter your own giveaway." };

  const existing = await db.giveawayEntry.findUnique({
    where: { giveawayId_userId: { giveawayId: g.id, userId } },
  });
  if (existing) return { ok: true, entries: existing.entries, bonus: existing.entries > 1 };

  // Bonus entries: an active/trialing subscription to the linked product
  const bonus =
    g.productId && g.memberBonus > 0
      ? await db.subscription.findFirst({
          where: { userId, productId: g.productId, status: { in: ["ACTIVE", "TRIALING"] } },
          select: { id: true },
        })
      : null;
  const entryCount = 1 + (bonus ? g.memberBonus : 0);

  await db.giveawayEntry.create({
    data: { giveawayId: g.id, userId, entries: entryCount },
  });
  await notify({
    userId: g.creatorId,
    type: "giveaway_entered",
    title: `New giveaway entry — ${g.title}`,
    body: `Someone just entered your drop.${g.product ? ` (${g.product.title})` : ""}`,
    icon: "gift",
  });
  return { ok: true, entries: entryCount, bonus: !!bonus };
}
