/**
 * Vendly recurring worker.
 *
 * Ticks the marketplace billing engine on a schedule: every TICK_MS it fires
 * POST http://localhost:3000/api/billing/tick (with the shared worker secret),
 * which runs renewals, trial conversions, dunning, payout/commission
 * settlement and giveaway draws against the current (possibly simulated)
 * clock, recording a durable WorkerRun row per tick.
 *
 * HTTP surface (reached through the gateway with ?XTransformPort=3040):
 *   GET  /status   → { running, tickMs, lastTickAt, nextTickAt, lastResult, history }
 *   POST /pause    → stop the schedule (manual runs still allowed)
 *   POST /resume   → restart the schedule
 *   POST /run      → fire a tick immediately
 *   POST /settings → { tickMs } adjust the interval (min 10s)
 *
 * The Next.js app talks to this service from the creator-studio worker panel.
 */

const PORT = 3040;
const TICK_MS_DEFAULT = 60_000;
const MIN_TICK_MS = 10_000;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const WORKER_SECRET = process.env.WORKER_SECRET || "vendly-worker-7f3a9c";
const HISTORY_LIMIT = 20;

interface TickResult {
  at: string;
  ok: boolean;
  renewals?: number;
  renewalsFailed?: number;
  canceled?: number;
  trialsConverted?: number;
  invoicesCreated?: number;
  durationMs?: number;
  events?: string[];
  error?: string;
}

const state = {
  running: true,
  tickMs: TICK_MS_DEFAULT,
  lastTickAt: null as number | null,
  nextTickAt: null as number | null,
  ticking: false,
  history: [] as TickResult[],
};

let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleNext() {
  if (timer) clearTimeout(timer);
  if (!state.running) {
    state.nextTickAt = null;
    return;
  }
  const wait = Math.max(1000, state.tickMs - (state.lastTickAt ? Date.now() - state.lastTickAt : 0));
  state.nextTickAt = Date.now() + wait;
  timer = setTimeout(() => {
    void fireTick("WORKER");
  }, wait);
}

async function fireTick(source: "WORKER" | "MANUAL"): Promise<TickResult> {
  const at = new Date().toISOString();
  if (state.ticking) {
    const skipped: TickResult = { at, ok: true, error: "skipped — a tick is already in flight" };
    return skipped;
  }
  state.ticking = true;
  const t0 = Date.now();
  let result: TickResult = { at, ok: false, error: "unreachable" };
  try {
    const res = await fetch(`${APP_URL}/api/billing/tick`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": WORKER_SECRET },
      body: JSON.stringify({ source }),
    });
    const data = ((await res.json().catch(() => ({}))) || {}) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(data.error || `tick failed (${res.status})`));
    result = {
      at,
      ok: true,
      renewals: Number(data.renewals ?? 0),
      renewalsFailed: Number(data.renewalsFailed ?? 0),
      canceled: Number(data.canceled ?? 0),
      trialsConverted: Number(data.trialsConverted ?? 0),
      invoicesCreated: Number(data.invoicesCreated ?? 0),
      durationMs: Number(data.durationMs ?? Date.now() - t0),
      events: Array.isArray(data.events) ? (data.events as string[]).slice(0, 8) : [],
    };
  } catch (e) {
    result = { at, ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    state.ticking = false;
    state.lastTickAt = Date.now();
    state.history.unshift(result);
    state.history = state.history.slice(0, HISTORY_LIMIT);
    scheduleNext();
  }
  const icon = result.ok
    ? `renewals=${result.renewals} invoices=${result.invoicesCreated} (${result.durationMs}ms)`
    : `ERROR ${result.error}`;
  console.log(`[worker] tick ${result.at} → ${icon}`);
  return result;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    if (path === "/status" && req.method === "GET") {
      return json({
        service: "vendly-worker",
        port: PORT,
        running: state.running,
        tickMs: state.tickMs,
        lastTickAt: state.lastTickAt ? new Date(state.lastTickAt).toISOString() : null,
        nextTickAt: state.nextTickAt ? new Date(state.nextTickAt).toISOString() : null,
        ticking: state.ticking,
        appUrl: APP_URL,
        history: state.history,
      });
    }

    if (path === "/pause" && req.method === "POST") {
      state.running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      state.nextTickAt = null;
      console.log("[worker] paused");
      return json({ ok: true, running: false });
    }

    if (path === "/resume" && req.method === "POST") {
      state.running = true;
      scheduleNext();
      console.log("[worker] resumed");
      return json({ ok: true, running: true, nextTickAt: state.nextTickAt ? new Date(state.nextTickAt).toISOString() : null });
    }

    if (path === "/run" && req.method === "POST") {
      const result = await fireTick("MANUAL");
      return json({ ok: result.ok, result });
    }

    if (path === "/settings" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as { tickMs?: number };
      const ms = Math.max(MIN_TICK_MS, Math.round(Number(body.tickMs) || 0));
      if (ms) {
        state.tickMs = ms;
        scheduleNext();
        console.log(`[worker] interval set to ${ms}ms`);
        return json({ ok: true, tickMs: state.tickMs });
      }
      return json({ ok: false, error: "tickMs must be a positive number" }, 400);
    }

    if (path === "/" && req.method === "GET") {
      return json({ service: "vendly-worker", ok: true, hint: "use /status" });
    }

    return json({ error: "Not found" }, 404);
  },
});

console.log(`[worker] Vendly recurring worker listening on :${PORT} — tick every ${TICK_MS_DEFAULT / 1000}s → ${APP_URL}/api/billing/tick`);

// Fire an initial tick shortly after boot so the panel has fresh data.
setTimeout(() => {
  void fireTick("WORKER");
}, 2500);
scheduleNext();
