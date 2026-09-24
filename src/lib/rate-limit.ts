// ============ In-memory rate limiter ============
//
// Sliding-window counters keyed by (bucket, identity) — identity is usually
// the caller's user id when authenticated, else the client IP. Local-memory
// by design (single-instance deploy); swap the store for Redis when scaling
// horizontally.
//
// Usage inside a route:
//   const limited = rateLimit({ req, bucket: "checkout", userId: user.id, max: 8, windowMs: 60_000 });
//   if (limited) return limited; // 429 Response with Retry-After

interface RateLimitOpts {
  req: Request;
  bucket: string;
  userId?: string | null;
  max: number; // allowed requests per window
  windowMs: number;
}

interface WindowState {
  hits: number[];
}

const store = new Map<string, WindowState>();
const MAX_KEYS = 20_000; // bound memory: drop arbitrary entries when full

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** Returns a 429 Response when the caller exceeded the window, else null. */
export function rateLimit(opts: RateLimitOpts): Response | null {
  const identity = opts.userId || clientIp(opts.req);
  const key = `${opts.bucket}:${identity}`;
  const now = Date.now();

  let state = store.get(key);
  if (!state) {
    if (store.size >= MAX_KEYS) {
      // Evict a batch of expired-ish entries rather than growing unbounded.
      let dropped = 0;
      for (const [k, v] of store) {
        if (v.hits.length === 0 || v.hits[v.hits.length - 1] < now - opts.windowMs) {
          store.delete(k);
          if (++dropped >= 200) break;
        }
      }
      if (store.size >= MAX_KEYS) store.clear(); // last resort
    }
    state = { hits: [] };
    store.set(key, state);
  }

  // Slide the window: keep only hits inside the current window.
  state.hits = state.hits.filter((t) => t > now - opts.windowMs);
  if (state.hits.length >= opts.max) {
    const retryAfterSec = Math.max(1, Math.ceil((state.hits[0] + opts.windowMs - now) / 1000));
    return new Response(
      JSON.stringify({ error: `Too many requests — try again in ${retryAfterSec}s.` }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) },
      }
    );
  }
  state.hits.push(now);
  return null;
}
