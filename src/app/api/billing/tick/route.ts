import { db } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/session";
import { runBilling } from "@/lib/billing";
import { getNow } from "@/lib/clock";

// Recurring billing worker endpoints.
//
// POST /api/billing/tick — runs the billing engine on the current (possibly
// simulated) clock and records a WorkerRun row. Called on a schedule by the
// worker mini-service (header x-worker-secret) and by "Run now" in the
// creator studio worker panel (demo session header). Concurrency is guarded
// inside runBilling itself (real Whop charges must never double-run).
//
// GET /api/billing/tick — worker panel data: recent run history + the next
// scheduled renewal (drives the countdown in the UI).

const MAX_RUNS = 25;

// Must match the worker mini-service default (mini-services/worker/index.ts)
// so a missing .env entry can never silently kill the recurring engine.
const WORKER_SECRET_DEFAULT = "vendly-worker-7f3a9c";

function workerSecret(): string {
  return process.env.WORKER_SECRET || WORKER_SECRET_DEFAULT;
}

function isWorkerRequest(req: Request): boolean {
  return req.headers.get("x-worker-secret") === workerSecret();
}

// Trim history so the table stays small — by REAL time, so a clock reset
// can never make future-dated rows evict fresh live runs.
async function trimRuns(): Promise<void> {
  const count = await db.workerRun.count();
  if (count > MAX_RUNS) {
    const oldest = await db.workerRun.findMany({
      orderBy: { recordedAt: "asc" },
      take: count - MAX_RUNS,
      select: { id: true },
    });
    await db.workerRun.deleteMany({ where: { id: { in: oldest.map((r) => r.id) } } });
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let source = "MANUAL";
  try {
    // A request that PRESENTS a worker secret but fails auth is a misconfigured
    // worker — record it as a failed run so the creator panel surfaces the
    // outage instead of silently showing stale "ok" history (R22 incident).
    const presentedSecret = req.headers.get("x-worker-secret");
    if (presentedSecret && !isWorkerRequest(req)) {
      const at = await getNow();
      await db.workerRun
        .create({
          data: {
            startedAt: at,
            recordedAt: new Date(),
            source: "WORKER",
            durationMs: Date.now() - startedAt,
            error: "Worker secret mismatch — check WORKER_SECRET in .env vs mini-services/worker",
          },
        })
        .catch(() => undefined);
      await trimRuns().catch(() => undefined);
    }
    if (!isWorkerRequest(req)) {
      // Demo-session users may fire manual ticks from the creator studio.
      const { requireUser } = await import("@/lib/session");
      await requireUser(req);
    } else {
      source = "WORKER";
    }

    const summary = await runBilling();
    const durationMs = Date.now() - startedAt;
    const at = await getNow();
    await db.workerRun.create({
      data: {
        startedAt: at,
        // Real wall-clock stamp — ordering/retention anchor (startedAt follows
        // the simulated platform clock and can be future-dated after a reset).
        recordedAt: new Date(),
        source,
        durationMs,
        renewals: summary.renewals,
        renewalsFailed: summary.renewalsFailed,
        canceled: summary.canceled,
        trialsConverted: summary.trialsConverted,
        invoicesCreated: summary.invoicesCreated,
        events: JSON.stringify(summary.events.slice(0, 40)),
      },
    });
    await trimRuns();
    const skipped = summary.events.some((e) => e.startsWith("Skipped"));
    return Response.json({ ok: true, skipped, ...summary, durationMs });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    const durationMs = Date.now() - startedAt;
    const at = await getNow();
    await db.workerRun
      .create({
        data: {
          startedAt: at,
          recordedAt: new Date(),
          source,
          durationMs,
          error: e instanceof Error ? e.message.slice(0, 300) : "Unknown error",
        },
      })
      .catch(() => undefined);
    return errorResponse(e);
  }
}

export async function GET(req: Request) {
  try {
    const { requireUser } = await import("@/lib/session");
    await requireUser(req);

    // Newest first by REAL wall-clock time (startedAt can be future-dated
    // when the platform clock was simulated at write time).
    const runs = await db.workerRun.findMany({ orderBy: { recordedAt: "desc" }, take: 12 });

    // Next scheduled renewal across all active/trialing subscriptions —
    // powers the "next tick will process…" hint in the worker panel. Uses
    // the PLATFORM clock so simulated time is honored.
    const now = await getNow();
    const next = await db.subscription.findFirst({
      where: {
        status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
        currentPeriodEnd: { gt: now },
        cancelAtPeriodEnd: false,
      },
      orderBy: { currentPeriodEnd: "asc" },
      include: { plan: { include: { product: true } } },
    });

    return Response.json({
      runs: runs.map((r) => ({
        id: r.id,
        source: r.source,
        startedAt: r.startedAt.toISOString(),
        durationMs: r.durationMs,
        renewals: r.renewals,
        renewalsFailed: r.renewalsFailed,
        canceled: r.canceled,
        trialsConverted: r.trialsConverted,
        invoicesCreated: r.invoicesCreated,
        events: JSON.parse(r.events || "[]") as string[],
        error: r.error,
      })),
      nextDue: next
        ? {
            at: next.currentPeriodEnd.toISOString(),
            productTitle: next.plan.product.title,
            planName: next.plan.name,
          }
        : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
