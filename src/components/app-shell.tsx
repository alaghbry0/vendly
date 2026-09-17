"use client";

// App shell: sticky header, client-side view router, sticky footer.
import { useEffect, useState } from "react";
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
  Compass, CreditCard, LayoutDashboard, LogIn, Menu, Moon, Search, Store, Sun, Timer, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SessionUser } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

function Header() {
  const { user, users, view, clock, navigate, switchUser, bootstrap } = useAppStore();
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
      await bootstrap();
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
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products, communities, SaaS…"
            className="h-9 rounded-full border-muted bg-muted/50 pl-9 text-sm"
            aria-label="Search marketplace"
          />
        </form>

        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Primary">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => navigate(item.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                view === item.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              aria-current={view === item.key ? "page" : undefined}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
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
  return (
    <footer className="mt-auto border-t bg-muted/40">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row">
          <div>
            <div className="flex items-center gap-2 font-bold">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                <Store className="h-3.5 w-3.5" />
              </span>
              Vendly
            </div>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
              The all-in-one marketplace for memberships, digital products and communities. Recurring billing across
              Stripe, PayPal and crypto — with automated license keys, secure delivery and event-driven access.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-xs text-muted-foreground sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold text-foreground">Marketplace</p>
              <span>Discover products</span>
              <span>Pricing tiers</span>
              <span>Reviews</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold text-foreground">Members</p>
              <span>Billing portal</span>
              <span>License keys</span>
              <span>Secure downloads</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="font-semibold text-foreground">Creators</p>
              <span>Analytics &amp; MRR</span>
              <span>Webhooks</span>
              <span>Subscriber CRM</span>
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
