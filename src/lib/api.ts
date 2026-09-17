"use client";

// Client-side fetch helper that attaches the demo session header.
import { useAppStore } from "@/lib/store";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; json?: unknown } = {}
): Promise<T> {
  const userId = useAppStore.getState().user?.id;
  const res = await fetch(path, {
    method: opts.method || (opts.json !== undefined ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-user-id": userId } : {}),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as { error?: string })?.error || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}
