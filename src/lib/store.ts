"use client";

// Global app state: demo session, client-side view router, sim clock.
import { create } from "zustand";
import type { ClockDTO, DemoUser, SessionUser, View } from "@/lib/types";

export interface AppParams {
  productId?: string;
  planId?: string;
  query?: string;
  category?: string;
  portalTab?: string;
  creatorTab?: string;
}

interface AppState {
  hydrated: boolean;
  user: SessionUser | null;
  users: DemoUser[];
  view: View;
  params: AppParams;
  clock: ClockDTO;
  nonce: number; // bump to trigger data refetches

  bootstrap: () => Promise<void>;
  navigate: (view: View, params?: AppParams) => void;
  switchUser: (userId: string) => Promise<void>;
  loginUser: (user: SessionUser) => Promise<void>;
  setUser: (user: SessionUser) => void;
  setClock: (clock: ClockDTO) => void;
  refresh: () => void;
}

const STORAGE_KEY = "vendly:userId";

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  user: null,
  users: [],
  view: "discover",
  params: {},
  clock: { simulated: false, now: new Date().toISOString(), label: "Live" },
  nonce: 0,

  bootstrap: async () => {
    try {
      const res = await fetch("/api/bootstrap");
      const data = (await res.json()) as { users: DemoUser[]; clock: ClockDTO };
      const storedId = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      const user = data.users.find((u) => u.id === storedId) || data.users.find((u) => u.email === "alex@demo.io") || data.users[0] || null;
      if (user && typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, user.id);
      set({ users: data.users, user, clock: data.clock, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  navigate: (view, params = {}) => {
    set({ view, params });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  },

  switchUser: async (userId) => {
    const u = get().users.find((x) => x.id === userId);
    if (u) {
      if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, u.id);
      set({ user: u, view: "discover", params: {}, nonce: get().nonce + 1 });
    }
  },

  // Sign in as an arbitrary (possibly brand-new) account from /api/auth/login.
  // Persists the id so bootstrap restores it, sets the session immediately and
  // refreshes the user list so the new account shows up in the switcher.
  loginUser: async (user) => {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, user.id);
    set({ user, nonce: get().nonce + 1 });
    try {
      const res = await fetch("/api/bootstrap");
      const data = (await res.json()) as { users: DemoUser[]; clock: ClockDTO };
      set({ users: data.users, clock: data.clock, hydrated: true });
    } catch {
      // keep the already-set session even if the refresh fails
    }
  },

  setUser: (user) => set({ user }),

  setClock: (clock) => set({ clock }),

  refresh: () => set({ nonce: get().nonce + 1 }),
}));
