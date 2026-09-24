// Formatting helpers (client-safe)

export function fmtMoney(cents: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (cents == null) return "—";
  const v = cents / 100;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function fmtCompact(n: number): string {
  return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// `nowMs` anchors relative time to the PLATFORM clock (see use-now.ts).
// Omit it only for pure real-time contexts — inside the app, always pass
// usePlatformNowMs() so simulated time renders consistently.
export function timeAgo(iso: string | null | undefined, nowMs?: number): string {
  if (!iso) return "—";
  const now = nowMs ?? Date.now();
  const diff = now - new Date(iso).getTime();
  if (diff < 0) return "in " + timeUntil(iso, nowMs);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

export function timeUntil(iso: string | null | undefined, nowMs?: number): string {
  if (!iso) return "—";
  const now = nowMs ?? Date.now();
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return "now";
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(diff / 60000))}m`;
}

// Themable gradient covers for products (no external images needed)
export const COVER_THEMES: Record<string, string> = {
  emerald: "from-emerald-500 via-teal-500 to-cyan-600",
  violet: "from-violet-500 via-purple-500 to-fuchsia-600",
  rose: "from-rose-500 via-pink-500 to-red-500",
  amber: "from-amber-400 via-orange-500 to-red-500",
  cyan: "from-cyan-400 via-sky-500 to-teal-600",
  lime: "from-lime-400 via-green-500 to-emerald-600",
  orange: "from-orange-400 via-amber-500 to-yellow-500",
  teal: "from-teal-400 via-emerald-500 to-green-600",
  fuchsia: "from-fuchsia-500 via-pink-500 to-rose-500",
};

export const AVATAR_GRADIENTS: Record<string, string> = COVER_THEMES;
