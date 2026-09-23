import { db } from "@/lib/db";
import { errorResponse, HttpError } from "@/lib/session";
import { runBilling } from "@/lib/billing";

// Recurring billing worker endpoints.
//
// POST /api/billing/tick — runs the billing engine on the current (possibly
// simulated) clock and records a WorkerRun row. Called on a schedule by the
// worker mini-service (header x-worker-secret) and by "Run now" in the
// creator studio worker panel (demo session header).
//
// GET /api/billing/tick — worker panel data: recent run history + the next
// scheduled renewal (drives the countdown in the UI).

const MAX_RUNS = 25;

function isWorkerRequest(req: Request): boolean {
  const secret = process.env.WORKER_SECRET || "";
  return !!secret && req.headers.get("x-worker-secret") === secret;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let source = "MANUAL";
  try {
    if (!isWorkerRequest(req)) {
      // Demo-session users may fire manual ticks from the creator studio.
      const { requireUser } = await import("@/lib/session");
      await requireUser(req);
    } else {
      source = "WORKER";
    }

    // Soft guard: skip if another run is in flight (time-machine advance +
    // worker tick can overlap; the engine is safe to re-run, but why pile on).
    const inflight = await db.workerRun.findFirst({
      where: { startedAt: { gt: new Date(Date.now() - 15000) }, error: null, durationMs: 0 },
    });

    const summary = await runBilling();
    const durationMs = Date.now() - startedAt;
    await db.workerRun.create({
      data: {
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
    // Trim history so the table stays small.
    const count = await db.workerRun.count();
    if (count > MAX_RUNS) {
      const oldest = await db.workerRun.findMany({
        orderBy: { startedAt: "asc" },
        take: count - MAX_RUNS,
        select: { id: true },
      });
      await db.workerRun.deleteMany({ where: { id: { in: oldest.map((r) => r.id) } } });
    }
    return Response.json({ ok: true, skipped: !!inflight, ...summary, durationMs });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e);
    const durationMs = Date.now() - startedAt;
    await db.workerRun
      .create({
        data: {
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

    const runs = await db.workerRun.findMany({ orderBy: { startedAt: "desc" }, take: 12 });

    // Next scheduled renewal across all active/trialing subscriptions —
    // powers the "next tick will process…" hint in the worker panel.
    const now = new Date();
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
