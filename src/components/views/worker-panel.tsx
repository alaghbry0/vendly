"use client";

// Recurring worker panel — creator studio (time-machine tab).
//
// Surfaces the worker mini-service (mini-services/worker, port 3040): a
// scheduled process that ticks the billing engine every minute so renewals,
// trial conversions, dunning, payout/commission settlement and giveaway draws
// happen on their own — no manual time-machine advance needed.
//
// Liveness + controls come straight from the worker service through the
// gateway (?XTransformPort=3040); the durable run history comes from
// GET /api/billing/tick (WorkerRun rows).

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  Ban,
  CircleAlert,
  Cog,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ReceiptText,
  Server,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const WORKER_PORT = 3040;

interface WorkerStatus {
  service: string;
  running: boolean;
  tickMs: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  ticking: boolean;
  history: { at: string; ok: boolean; renewals?: number; invoicesCreated?: number; error?: string }[];
}

interface TickRun {
  id: string;
  source: string;
  startedAt: string;
  durationMs: number;
  renewals: number;
  renewalsFailed: number;
  canceled: number;
  trialsConverted: number;
  invoicesCreated: number;
  events: string[];
  error: string | null;
}

interface TickData {
  runs: TickRun[];
  nextDue: { at: string; productTitle: string; planName: string } | null;
}

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  WORKER: { label: "Worker", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  MANUAL: { label: "Manual", cls: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  TIME_MACHINE: { label: "Time machine", cls: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function countdown(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "now";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function WorkerPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [data, setData] = useState<TickData | null>(null);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, setTickNow] = useState(0); // 1s re-render clock for countdowns
  const alive = useRef(true);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/status?XTransformPort=${WORKER_PORT}`, { cache: "no-store" });
      const s = (await res.json()) as WorkerStatus;
      if (alive.current) {
        setStatus(s);
        setOffline(false);
      }
    } catch {
      if (alive.current) setOffline(true);
    }
    try {
      const d = await api<TickData>("/api/billing/tick");
      if (alive.current) setData(d);
    } catch {
      /* history is best-effort */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void poll();
    const t1 = setInterval(() => void poll(), 8000);
    const t2 = setInterval(() => setTickNow((n) => n + 1), 1000);
    return () => {
      alive.current = false;
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [poll]);

  async function control(path: "pause" | "resume" | "run", okTitle: string) {
    setBusy(true);
    try {
      const res = await fetch(`/${path}?XTransformPort=${WORKER_PORT}`, { method: "POST" });
      if (!res.ok) throw new Error(`Worker responded ${res.status}`);
      toast({ title: okTitle });
      await poll();
    } catch (e) {
      toast({ title: "Worker unreachable", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function setInterval_(ms: number) {
    setBusy(true);
    try {
      const res = await fetch(`/settings?XTransformPort=${WORKER_PORT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickMs: ms }),
      });
      if (!res.ok) throw new Error(`Worker responded ${res.status}`);
      toast({ title: `Tick interval set to ${ms / 1000}s` });
      await poll();
    } catch (e) {
      toast({ title: "Worker unreachable", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const stateBadge = offline ? (
    <Badge variant="outline" className="gap-1.5 border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400">
      <CircleAlert className="h-3 w-3" /> Offline
    </Badge>
  ) : status?.running ? (
    <Badge variant="outline" className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Running
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
      <Pause className="h-3 w-3" /> Paused
    </Badge>
  );

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Server className="h-4.5 w-4.5" />
          </span>
          <div>
            <h2 className="text-sm font-bold">Recurring billing worker</h2>
            <p className="text-xs text-muted-foreground">
              A scheduled process ticks the billing engine automatically — renewals, trials, dunning & settlements.
            </p>
          </div>
        </div>
        {stateBadge}
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[320px_1fr]">
        {/* Status + controls */}
        <div className="space-y-4">
          <div className="rounded-xl border bg-muted/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Next tick</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {offline ? "—" : status?.running && status.nextTickAt ? countdown(status.nextTickAt) : status?.running ? "running…" : "paused"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {offline
                ? "Start the worker service to resume automatic billing runs."
                : status?.running
                  ? `Every ${Math.round((status.tickMs || 60000) / 1000)}s · last tick ${status.lastTickAt ? relTime(status.lastTickAt) : "—"}`
                  : "Resume to keep the billing engine on schedule."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-9"
              disabled={busy || offline || running}
              onClick={async () => {
                setRunning(true);
                try {
                  await fetch(`/run?XTransformPort=${WORKER_PORT}`, { method: "POST" });
                  toast({ title: "Worker tick fired", description: "The billing engine just ran — refresh the history below." });
                  await poll();
                } catch {
                  toast({ title: "Worker unreachable", variant: "destructive" });
                } finally {
                  setRunning(false);
                }
              }}
            >
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Run now
            </Button>
            {!offline && status?.running ? (
              <Button size="sm" variant="outline" className="h-9" disabled={busy} onClick={() => void control("pause", "Worker paused")}>
                <Pause className="h-3.5 w-3.5" /> Pause
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-9" disabled={busy || offline} onClick={() => void control("resume", "Worker resumed")}>
                <Play className="h-3.5 w-3.5" /> Resume
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <Cog className="h-3.5 w-3.5 text-muted-foreground" />
              <Select
                value={String(status?.tickMs ?? 60000)}
                onValueChange={(v) => void setInterval_(Number(v))}
                disabled={busy || offline}
              >
                <SelectTrigger className="h-9 w-[110px] text-xs" aria-label="Tick interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10000">every 10s</SelectItem>
                  <SelectItem value="30000">every 30s</SelectItem>
                  <SelectItem value="60000">every 60s</SelectItem>
                  <SelectItem value="300000">every 5m</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {data?.nextDue && (
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.06] p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-400">
                <Activity className="h-3.5 w-3.5" /> Next scheduled renewal
              </p>
              <p className="mt-1.5 text-sm font-semibold">{data.nextDue.productTitle}</p>
              <p className="text-xs text-muted-foreground">
                {data.nextDue.planName} · {new Date(data.nextDue.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                The worker will process it automatically — or use the time machine to jump ahead.
              </p>
            </div>
          )}
        </div>

        {/* Run history */}
        <div>
          <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="h-3.5 w-3.5" /> Recent runs
          </p>
          {!data || data.runs.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No runs recorded yet — the worker ticks every minute and history appears here.
            </div>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto pr-1" aria-label="Worker run history">
              {data.runs.map((run, i) => {
                const meta = SOURCE_META[run.source] || SOURCE_META.MANUAL;
                const total = run.renewals + run.trialsConverted;
                return (
                  <motion.li
                    key={run.id}
                    initial={i < 3 ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border px-3.5 py-2.5 text-sm",
                      run.error ? "border-red-500/25 bg-red-500/[0.05]" : "bg-muted/30"
                    )}
                  >
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", meta.cls)}>
                      {meta.label}
                    </span>
                    <span className="tabular-nums text-xs text-muted-foreground" title={new Date(run.startedAt).toLocaleString()}>
                      {relTime(run.startedAt)}
                    </span>
                    {run.error ? (
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
                        <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{run.error}</span>
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2 text-xs">
                        {total > 0 && (
                          <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                            <RefreshCw className="h-3 w-3" /> {run.renewals + run.trialsConverted} processed
                          </span>
                        )}
                        {run.invoicesCreated > 0 && (
                          <span className="flex items-center gap-1 text-teal-700 dark:text-teal-400">
                            <ReceiptText className="h-3 w-3" /> {run.invoicesCreated} invoices
                          </span>
                        )}
                        {run.renewalsFailed > 0 && (
                          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
                            <Ban className="h-3 w-3" /> {run.renewalsFailed} failed
                          </span>
                        )}
                        {run.canceled > 0 && (
                          <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                            <Ban className="h-3 w-3" /> {run.canceled} canceled
                          </span>
                        )}
                        {total === 0 && run.invoicesCreated === 0 && run.renewalsFailed === 0 && run.canceled === 0 && (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Sparkles className="h-3 w-3" /> nothing due · {run.durationMs}ms
                          </span>
                        )}
                      </span>
                    )}
                  </motion.li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
