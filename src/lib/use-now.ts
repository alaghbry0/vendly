"use client";

// Platform-clock "now" for relative-time rendering.
//
// The backend clock may be simulated (time machine). The store captures the
// server's clock.now plus the real moment it was fetched; this hook advances
// that instant in lock-step with real time and re-renders every 30s so
// relative labels stay live:
//
//   platformNow = clock.now + (Date.now() - clockFetchedAt)   [simulated]
//   platformNow = Date.now()                                   [live]
//
// Pass the returned ms to timeAgo()/timeUntil() so every "X ago" label is
// consistent with the simulated frame (e.g. after +30d, a notification from
// before the jump reads "30d ago", not "20m ago").

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";

export function usePlatformNowMs(tickMs = 30_000): number {
  const clock = useAppStore((s) => s.clock);
  const clockFetchedAt = useAppStore((s) => s.clockFetchedAt);
  const [, force] = useState(0);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), tickMs);
    return () => clearInterval(t);
  }, [tickMs]);

  const baseMs = +new Date(clock.now);
  if (!clock.simulated || !Number.isFinite(baseMs)) return Date.now();
  return baseMs + Math.max(0, Date.now() - clockFetchedAt);
}
