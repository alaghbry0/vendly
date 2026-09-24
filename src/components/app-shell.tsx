"use client";

// App shell: sticky header, client-side view router, sticky footer.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import { UserAvatar, StatusBadge } from "@/components/shared";
import { MarketplaceViews } from "@/components/views/marketplace-views";
import { PortalViews } from "@/components/views/portal-views";
import { CreatorViews } from "@/components/views/creator-views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Bell, Banknote, Compass, CreditCard, Gift, KeyRound, LayoutDashboard, LogIn, Menu, MessageSquare, Moon,
  Receipt, RefreshCw, Search, Star, Store, Sun, Tag, Timer, UserPlus, X, XCircle, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClockDTO, NotificationDTO, SessionUser } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import { usePlatformNowMs } from "@/lib/use-now";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Notification center (header bell)
// ---------------------------------------------------------------------------

const NOTIF_ICONS: Record<string, { icon: typeof Bell; cls: string }> = {
  receipt: { icon: Receipt, cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  alert: { icon: AlertTriangle, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  "user-plus": { icon: UserPlus, cls: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  "x-circle": { icon: XCircle, cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  refresh: { icon: RefreshCw, cls: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" },
  key: { icon: KeyRound, cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  star: { icon: Star, cls: "bg-amber-500/10 text-amber-500" },
  tag: { icon: Tag, cls: "bg-lime-500/10 text-lime-600 dark:text-lime-400" },
  bank: { icon: Banknote, cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  gift: { icon: Gift, cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  message: { icon: MessageSquare, cls: "bg-teal-500/10 text-teal-600 dark:text-teal-400" },
  bell: { icon: Bell, cls: "bg-muted text-muted-foreground" },
};

function NotifIcon({ icon, cls }: { icon: string; cls?: string }) {
  const meta = NOTIF_ICONS[icon] || NOTIF_ICONS.bell;
  const Icon = meta.icon;
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", meta.cls, cls)}>
      <Icon className="h-4 w-4" />
    </span>
  );
}

function NotificationBell() {
  const { user, nonce, navigate } = useAppStore();
  const nowMs = usePlatformNowMs();
  const [items, setItems] = useState<NotificationDTO[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api<{ notifications: NotificationDTO[]; unread: number; clock?: ClockDTO }>(
        "/api/notifications"
      );
      setItems(res.notifications);
      setUnread(res.unread);
      // Keep the platform-clock anchor fresh — after a time-machine advance
      // (even from another tab) relative times re-anchor within one poll.
      if (res.clock) useAppStore.getState().setClock(res.clock);
    } catch {
      // silent — the bell must never break the shell
    }
  }, [user]);

  useEffect(() => {
    void load();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void load(), 30000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load, nonce]);

  async function openNotification(n: NotificationDTO) {
    if (!n.read) {
      // optimistic read state
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? prev);
      setUnread((u) => Math.max(0, u - 1));
      try {
        await api(`/api/notifications/${n.id}/read`, { method: "POST" });
      } catch {
        void load(); // resync on failure
      }
    }
    setOpen(false);
    if (n.target) {
      if (n.target.view === "product") {
        navigate("product", { productId: n.target.productId });
      } else {
        navigate(n.target.view, n.target.view === "portal" ? { portalTab: n.target.tab } : { creatorTab: n.target.tab });
      }
    }
  }

  async function markAllRead() {
    if (!unread) return;
    setMarkingAll(true);
    setItems((prev) => prev?.map((x) => ({ ...x, read: true })) ?? prev);
    setUnread(0);
    try {
      await api("/api/notifications/read-all", { method: "POST" });
    } catch {
      void load();
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        >
          <Bell className="h-4.5 w-4.5" />
          {unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-background"
              aria-hidden="true"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] p-0 sm:w-96" aria-label="Notifications">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <Badge className="bg-rose-500/10 px-1.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                {unread} new
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={markingAll || unread === 0}
            onClick={markAllRead}
          >
            {markingAll ? "Marking…" : "Mark all read"}
          </Button>
        </div>

        <div className="max-h-[26rem] overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:hover:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent">
          {items === null ? (
            <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading notifications">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Bell className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium">You're all caught up</p>
              <p className="text-xs text-muted-foreground">
                Billing events, licenses, reviews and payouts land here.
              </p>
            </div>
          ) : (
            items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={(e) => {
                  e.preventDefault();
                  void openNotification(n);
                }}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-none border-b px-4 py-3 last:border-b-0 focus:bg-muted/60",
                  !n.read && "bg-emerald-500/[0.04]"
                )}
              >
                <NotifIcon icon={n.icon} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13px] leading-snug", !n.read && "font-semibold")}>
                    {n.title}
                  </span>
                  {n.body && (
                    <span className="mt-0.5 block line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {n.body}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] text-muted-foreground/80">{timeAgo(n.createdAt, nowMs)}</span>
                </span>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-label="unread" />}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Header() {
  const { user, users, view, clock, navigate, switchUser, loginUser } = useAppStore();
  const { theme, setTheme } = useTheme();
  const [search, setSearch] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const { toast } = useToast();

  const navItems = [
    { key: "discover" as const, label: "Discover", icon: Compass },
    { key: "portal" as const, label: "My Hub", icon: CreditCard },
    { key: "creator" as const, label: "Creator Studio", icon: LayoutDashboard },
  ];

  async function handleLogin() {
    setLoginBusy(true);
    try {
      const res = await api<SessionUser>("/api/auth/login", { json: { email: loginEmail } });
      await loginUser(res);
      setLoginOpen(false);
      setLoginEmail("");
      toast({ title: `Signed in as ${res.name}`, description: res.email });
    } catch (e) {
      toast({ title: "Sign in failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoginBusy(false);
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-background/85 backdrop-blur-lg">
      <div className="container mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
        <button
          className="flex items-center gap-2 font-bold tracking-tight"
          onClick={() => navigate("discover")}
          aria-label="Vendly home"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
            <Store className="h-4.5 w-4.5" />
          </span>
          <span className="text-lg">Vendly</span>
        </button>

        <form
          className="relative ml-2 hidden max-w-sm flex-1 md:block"
          onSubmit={(e) => {
            e.preventDefault();
            navigate("discover", { query: search });
          }}
          role="search"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors peer-focus:text-primary" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products, communities, SaaS…"
            className="h-9 rounded-full border-muted bg-muted/50 pl-9 pr-4 text-sm transition-[background-color,box-shadow,border-color] duration-200 placeholder:text-muted-foreground/70 hover:bg-muted focus-visible:border-primary/40 focus-visible:bg-background focus-visible:shadow-[0_0_0_4px_oklch(0.596_0.13_163/0.12)] dark:focus-visible:shadow-[0_0_0_4px_oklch(0.72_0.15_163/0.15)]"
            aria-label="Search marketplace"
          />
        </form>

        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Primary">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => navigate(item.key)}
              className={cn(
                "group relative flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                view === item.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              aria-current={view === item.key ? "page" : undefined}
            >
              <item.icon className={cn("h-4 w-4 transition-transform duration-200", view === item.key ? "scale-110" : "group-hover:scale-110 group-hover:-translate-y-px")} />
              {item.label}
              {view !== item.key && (
                <span className="absolute inset-x-3 -bottom-0.5 h-0.5 origin-left scale-x-0 rounded-full bg-primary/60 transition-transform duration-200 group-hover:scale-x-100" aria-hidden="true" />
              )}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 md:ml-2">
          {clock.simulated && (
            <button
              onClick={() => navigate("creator", { creatorTab: "time" })}
              className="hidden items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400 sm:flex"
              title="Simulated clock active — open the time machine"
            >
              <Timer className="h-3.5 w-3.5 animate-pulse" />
              {clock.label}
            </button>
          )}
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-full ring-2 ring-transparent transition hover:ring-primary/40" aria-label="Account menu">
                <UserAvatar name={user?.name} color={user?.avatarColor || "emerald"} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="flex items-center gap-2">
                <UserAvatar name={user?.name} color={user?.avatarColor || "emerald"} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{user?.name || "Guest"}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
                {user?.role === "CREATOR" && <Badge className="ml-auto bg-primary/10 text-primary">Creator</Badge>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">Switch demo account</DropdownMenuLabel>
              {users.map((u) => (
                <DropdownMenuItem
                  key={u.id}
                  onClick={() => switchUser(u.id)}
                  className={cn("gap-2", u.id === user?.id && "bg-accent")}
                >
                  <UserAvatar name={u.name} color={u.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.role === "CREATOR" ? `${u.productCount} products` : `${u.activeSubs} active subs`}
                    </p>
                  </div>
                  {u.role === "CREATOR" && <Badge variant="outline" className="text-[10px]">Creator</Badge>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLoginOpen(true)} className="gap-2">
                <LogIn className="h-4 w-4" /> Sign in with email
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full md:hidden"
            onClick={() => setMobileNav((v) => !v)}
            aria-label="Toggle navigation"
          >
            {mobileNav ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {loginOpen && (
        <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
                  <LogIn className="h-4 w-4" />
                </span>
                Sign in to Vendly
              </DialogTitle>
              <DialogDescription>
                Enter an email address to sign in. New emails create a fresh account instantly — perfect for
                testing the full buyer journey.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (loginEmail.trim()) handleLogin();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="login-email">Email address</Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => setLoginOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loginBusy || !loginEmail.trim()}>
                  {loginBusy ? "Signing in…" : "Continue"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {mobileNav && (
        <nav className="border-t bg-background px-4 py-3 md:hidden" aria-label="Mobile">
          <form
            className="relative mb-3"
            onSubmit={(e) => {
              e.preventDefault();
              navigate("discover", { query: search });
              setMobileNav(false);
            }}
          >
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-10 rounded-full pl-9" />
          </form>
          <div className="grid grid-cols-3 gap-2">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => {
                  navigate(item.key);
                  setMobileNav(false);
                }}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-medium",
                  view === item.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}

function Footer() {
  const { navigate } = useAppStore();
  return (
    <footer className="mt-auto border-t bg-muted/40">
      <div className="container mx-auto max-w-7xl px-4 py-10">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row">
          <div className="max-w-xs">
            <div className="flex items-center gap-2 font-bold">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                <Store className="h-3.5 w-3.5" />
              </span>
              Vendly
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The all-in-one marketplace for memberships, digital products and communities. Recurring billing across
              Stripe, PayPal and crypto — with automated license keys, secure delivery and event-driven access.
            </p>
            <div className="mt-3 flex items-center gap-2" aria-label="Supported payment methods">
              {[
                { label: "Stripe", cls: "bg-gradient-to-br from-violet-500/15 to-violet-600/10 text-violet-700 dark:text-violet-300 border-violet-500/25" },
                { label: "PayPal", cls: "bg-gradient-to-br from-sky-500/15 to-sky-600/10 text-sky-700 dark:text-sky-300 border-sky-500/25" },
                { label: "Crypto", cls: "bg-gradient-to-br from-amber-500/15 to-amber-600/10 text-amber-700 dark:text-amber-300 border-amber-500/25" },
              ].map((m) => (
                <span key={m.label} className={cn("rounded-md border px-2 py-0.5 text-[10px] font-semibold", m.cls)}>
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-x-12 gap-y-2 text-xs text-muted-foreground sm:grid-cols-3 md:w-auto">
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold text-foreground">Marketplace</p>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("discover")}>Discover products</button>
              <span>Pricing tiers</span>
              <span>Reviews</span>
              <span>Wishlists</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold text-foreground">Members</p>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("portal", { portalTab: "subscriptions" })}>Billing portal</button>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("portal", { portalTab: "licenses" })}>License keys</button>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("portal", { portalTab: "downloads" })}>Secure downloads</button>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("portal", { portalTab: "affiliates" })}>Affiliate earnings</button>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("portal", { portalTab: "giveaways" })}>Giveaway entries</button>
              <span>Notifications</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold text-foreground">Creators</p>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("creator")}>Analytics &amp; MRR</button>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("creator", { creatorTab: "promos" })}>Promo codes</button>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("creator", { creatorTab: "webhooks" })}>Webhooks</button>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("creator", { creatorTab: "payouts" })}>Payouts</button>
              <button className="w-fit text-left transition-colors hover:text-primary" onClick={() => navigate("creator", { creatorTab: "giveaways" })}>Giveaways</button>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-[11px] text-muted-foreground">
          <span>© {new Date().getFullYear()} Vendly — a Whop-style marketplace demo.</span>
          <span>Payments simulated · Stripe · PayPal · Crypto</span>
        </div>
      </div>
    </footer>
  );
}

export function AppShell() {
  const { hydrated, view, bootstrap } = useAppStore();

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <div className="flex h-16 items-center justify-center border-b">
          <span className="text-lg font-bold tracking-tight">Vendly</span>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm">Loading marketplace…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="flex-1">
        {view === "discover" || view === "product" || view === "checkout" ? <MarketplaceViews /> : null}
        {view === "portal" ? <PortalViews /> : null}
        {view === "creator" ? <CreatorViews /> : null}
      </main>
      <Footer />
    </div>
  );
}
