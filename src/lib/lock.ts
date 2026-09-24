import { db } from "@/lib/db";

// ============ Advisory DB locks ============
//
// Cross-process mutual exclusion for critical sections that must never
// overlap: the billing-engine run (real Whop charges — two overlapping runs
// could double-charge members) and per-user checkout provisioning (two
// racing checkouts could double-provision a subscription).
//
// Why a DB lock and not an in-process mutex: Next.js route handlers can be
// instantiated in isolated module contexts (dev/Turbopack) and the platform
// may eventually run multiple app instances — only the database is shared.
//
// Acquire is a single atomic UPDATE (SQLite serializes writers):
//   UPDATE AdvisoryLock SET lockedAt=now, owner=me
//   WHERE name=? AND (lockedAt IS NULL OR lockedAt < staleness-cutoff)
// A lock held past its TTL is considered abandoned (crashed holder) and may
// be taken over. Release only succeeds for the owning token, so a stalled
// holder can never release a lock that was legitimately taken over.

const DEFAULT_TTL_MS = 5 * 60_000;

function ownerToken(): string {
  return `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Tries to acquire `name`. Returns an owner token on success, null if held. */
export async function acquireLock(name: string, ttlMs = DEFAULT_TTL_MS): Promise<string | null> {
  const owner = ownerToken();
  // Ensure the row exists (idempotent; a racing create is swallowed).
  await db.advisoryLock
    .upsert({ where: { name }, update: {}, create: { name } })
    .catch(() => undefined);
  const cutoff = new Date(Date.now() - ttlMs);
  const res = await db.advisoryLock.updateMany({
    where: { name, OR: [{ lockedAt: null }, { lockedAt: { lt: cutoff } }] },
    data: { lockedAt: new Date(), owner },
  });
  return res.count === 1 ? owner : null;
}

/** Releases `name`, but only if the caller still owns it. */
export async function releaseLock(name: string, owner: string): Promise<void> {
  if (!owner) return;
  await db.advisoryLock
    .updateMany({ where: { name, owner }, data: { lockedAt: null, owner: "" } })
    .catch(() => undefined);
}
