"use client";

// CUSTOMER SELF-SERVICE BILLING PORTAL — "My Hub".
// Owned by Task 2-b. Rendered when store.view === "portal".
// Internal tab system (synced from params.portalTab): overview | subscriptions |
// licenses | downloads | wishlist | affiliates | invoices | payment-methods |
// settings.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useAppStore } from "@/lib/store";
import { api, ApiError } from "@/lib/api";
import type {
  AffiliateLinkDTO,
  GrantDTO,
  InvoiceDTO,
  LicenseDTO,
  PaymentMethodDTO,
  PlanDTO,
  ProductCardDTO,
  ProductDetailDTO,
  SessionUser,
  SubscriptionDTO,
  WishlistItemDTO,
} from "@/lib/types";
import { CATEGORIES } from "@/lib/types";
import { fmtBytes, fmtCompact, fmtDate, fmtDateTime, fmtMoney, timeAgo, timeUntil } from "@/lib/format";
import {
  CategoryIcon,
  CopyButton,
  EmptyState,
  GatewayBadge,
  ProductCover,
  ProviderBadge,
  SectionHeader,
  StatCard,
  StatusBadge,
  UserAvatar,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  AtSign,
  BadgeCheck,
  Ban,
  Banknote,
  Bitcoin,
  CalendarClock,
  CalendarRange,
  CalendarX,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Copy,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileArchive,
  FileAudio,
  FileCode,
  FileDown,
  FileImage,
  FileText,
  FileVideo,
  Heart,
  HeartOff,
  Info,
  KeyRound,
  LayoutDashboard,
  Loader2,
  Lock,
  MonitorSmartphone,
  MousePointerClick,
  Plus,
  ReceiptText,
  Repeat,
  RotateCcw,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Star,
  Store,
  Target,
  Timer,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// ============================================================================
// Constants, types & helpers
// ============================================================================

type PortalTab =
  | "overview"
  | "subscriptions"
  | "licenses"
  | "downloads"
  | "wishlist"
  | "affiliates"
  | "invoices"
  | "payment-methods"
  | "settings";

const PORTAL_TABS: { key: PortalTab; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "subscriptions", label: "Memberships", icon: Repeat },
  { key: "licenses", label: "Licenses", icon: KeyRound },
  { key: "downloads", label: "Downloads", icon: Download },
  { key: "wishlist", label: "Wishlist", icon: Heart },
  { key: "affiliates", label: "Affiliates", icon: Share2 },
  { key: "invoices", label: "Invoices", icon: ReceiptText },
  { key: "payment-methods", label: "Payment methods", icon: Wallet },
  { key: "settings", label: "Settings", icon: Settings },
];

const ACTIVE_STATUSES = ["ACTIVE", "TRIALING", "PAST_DUE"];
const STATUS_ORDER: Record<string, number> = { PAST_DUE: 0, TRIALING: 1, ACTIVE: 2, CANCELED: 3 };

interface PortalData {
  subs: SubscriptionDTO[];
  invoices: InvoiceDTO[];
  methods: PaymentMethodDTO[];
  licenses: LicenseDTO[];
  grants: GrantDTO[];
  wishlist: WishlistItemDTO[];
  affiliateLinks: AffiliateLinkDTO[];
}

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: "easeOut" } },
};

function monthlyCents(plan: PlanDTO): number {
  return plan.interval === "year" ? Math.round(plan.priceCents / 12) : plan.priceCents;
}

function shortWallet(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function pmShort(pm: PaymentMethodDTO): string {
  if (pm.type === "CARD") return `${pm.brand || "Card"} ••••${pm.last4}`;
  if (pm.type === "PAYPAL") return pm.email || "PayPal account";
  return shortWallet(pm.walletAddress || "");
}

function maskKey(key: string): string {
  const parts = key.split("-");
  return parts.map((p, i) => (i === 0 || i === parts.length - 1 ? p : "•".repeat(Math.max(4, p.length)))).join("-");
}

function fileIcon(mime: string): LucideIcon {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return FileArchive;
  if (mime.includes("json") || mime.includes("javascript") || mime.includes("html")) return FileCode;
  return FileText;
}

/** One-line summary of the next billing event for a subscription. */
function nextChargeLine(sub: SubscriptionDTO): string {
  if (sub.status === "PAST_DUE") return "Payment failed — update payment method";
  if (sub.status === "CANCELED") return `Ended ${fmtDate(sub.currentPeriodEnd)}`;
  if (sub.status === "TRIALING") return `Trial ends ${fmtDate(sub.trialEndsAt)}`;
  if (sub.cancelAtPeriodEnd) return `Cancels ${fmtDate(sub.currentPeriodEnd)}`;
  return `Next charge ${fmtMoney(sub.plan.priceCents)} on ${fmtDate(sub.currentPeriodEnd)}`;
}

function sortSubs(subs: SubscriptionDTO[]): SubscriptionDTO[] {
  return [...subs].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      +new Date(a.currentPeriodEnd) - +new Date(b.currentPeriodEnd)
  );
}

/** Card-style panel used across the portal (full control over padding). */
function Panel({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-2xl border bg-card shadow-sm", className)} {...props}>
      {children}
    </div>
  );
}

// ============================================================================
// Data loading
// ============================================================================

function usePortalData() {
  const nonce = useAppStore((s) => s.nonce);
  const userId = useAppStore((s) => s.user?.id);
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      try {
        const [subsRes, invoicesRes, methodsRes, licensesRes, grantsRes, wishlistRes, affiliatesRes] =
          await Promise.all([
            api<{ subscriptions: SubscriptionDTO[] }>("/api/subscriptions"),
            api<{ invoices: InvoiceDTO[] }>("/api/invoices"),
            api<{ paymentMethods: PaymentMethodDTO[] }>("/api/payment-methods"),
            api<{ licenses: LicenseDTO[] }>("/api/licenses"),
            api<{ grants: GrantDTO[] }>("/api/grants"),
            api<{ items: WishlistItemDTO[] }>("/api/wishlist"),
            api<{ links: AffiliateLinkDTO[] }>("/api/affiliates/links"),
          ]);
        if (!alive) return;
        setData({
          subs: subsRes.subscriptions,
          invoices: invoicesRes.invoices,
          methods: methodsRes.paymentMethods,
          licenses: licensesRes.licenses,
          grants: grantsRes.grants,
          wishlist: wishlistRes.items,
          affiliateLinks: affiliatesRes.links,
        });
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load your hub.");
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [nonce, userId]);

  // Un-save a wishlist product (POST /api/wishlist toggles). The local copy is
  // patched in place instead of refetching everything, so AnimatePresence exit
  // animations stay snappy and the tab survives round-trips.
  const removeWishlistItem = useCallback(async (productId: string) => {
    const res = await api<{ saved: boolean }>("/api/wishlist", { method: "POST", json: { productId } });
    if (res.saved) {
      // Toggle raced a double-fire and the item got re-saved — resync from the server.
      useAppStore.getState().refresh();
      return;
    }
    setData((prev) => (prev ? { ...prev, wishlist: prev.wishlist.filter((w) => w.product.id !== productId) } : prev));
  }, []);

  return { data, error, loading: !data && !error, removeWishlistItem };
}

// ============================================================================
// Root component
// ============================================================================

export function PortalViews() {
  const user = useAppStore((s) => s.user);
  const refresh = useAppStore((s) => s.refresh);
  const navigate = useAppStore((s) => s.navigate);
  const rawTab = useAppStore((s) => s.params.portalTab);
  const { data, error, removeWishlistItem } = usePortalData();

  // The active tab is fully store-driven: internal tab clicks write the param
  // via navigate(), and deep links from other views are picked up for free.
  const tab: PortalTab = PORTAL_TABS.some((t) => t.key === rawTab) ? (rawTab as PortalTab) : "overview";
  const [invoiceSubFilter, setInvoiceSubFilter] = useState<string>("all");

  const goToTab = useCallback(
    (next: PortalTab) => {
      navigate("portal", { portalTab: next });
    },
    [navigate]
  );
  const goToInvoices = useCallback(
    (subId: string) => {
      setInvoiceSubFilter(subId);
      goToTab("invoices");
    },
    [goToTab]
  );

  if (!user) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-16">
        <EmptyState
          icon={Wallet}
          title="Sign in to view your hub"
          description="Switch to a demo account from the avatar menu in the header to explore the billing portal."
        />
      </div>
    );
  }

  if (!data) {
    if (error) {
      return (
        <div className="container mx-auto max-w-7xl px-4 py-16">
          <EmptyState
            icon={TriangleAlert}
            title="Couldn't load your hub"
            description={error}
            action={
              <Button onClick={() => refresh()} className="rounded-xl">
                <RotateCcw className="h-4 w-4" /> Try again
              </Button>
            }
          />
        </div>
      );
    }
    return <PortalSkeleton />;
  }

  return (
    <motion.div
      className="container mx-auto max-w-7xl px-4 py-8 sm:py-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[14rem_1fr]">
        {/* ---------- Sidebar (desktop) ---------- */}
        <aside className="hidden lg:block">
          <nav className="sticky top-20 w-56" aria-label="Portal sections">
            <div className="mb-4 flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
              <UserAvatar name={user.name} color={user.avatarColor} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.name || "Member"}</p>
                <p className="truncate text-[11px] text-muted-foreground">My Hub · {user.email}</p>
              </div>
            </div>
            <ul className="flex flex-col gap-1">
              {PORTAL_TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <li key={t.key}>
                    <button
                      onClick={() => goToTab(t.key)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <t.icon className="h-4 w-4 shrink-0" />
                      {t.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 rounded-2xl border border-dashed p-4">
              <p className="text-xs font-semibold">Need help?</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Manage memberships, license keys, secure downloads and billing — all in one place.
              </p>
            </div>
          </nav>
        </aside>

        {/* ---------- Mobile pill nav ---------- */}
        <div className="lg:hidden">
          <div
            className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Portal sections"
          >
            <div className="flex gap-2">
              {PORTAL_TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => goToTab(t.key)}
                    className={cn(
                      "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <t.icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ---------- Tab content ---------- */}
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              {tab === "overview" && <OverviewTab user={user} data={data} goToTab={goToTab} />}
              {tab === "subscriptions" && (
                <SubscriptionsTab data={data} reload={refresh} goToInvoices={goToInvoices} />
              )}
              {tab === "licenses" && <LicensesTab licenses={data.licenses} reload={refresh} />}
              {tab === "downloads" && <DownloadsTab subs={data.subs} />}
              {tab === "wishlist" && (
                <WishlistTab items={data.wishlist} subs={data.subs} onRemove={removeWishlistItem} />
              )}
              {tab === "affiliates" && <AffiliatesTab links={data.affiliateLinks} />}
              {tab === "invoices" && (
                <InvoicesTab
                  invoices={data.invoices}
                  subs={data.subs}
                  subFilter={invoiceSubFilter}
                  onSubFilterChange={setInvoiceSubFilter}
                  user={user}
                />
              )}
              {tab === "payment-methods" && (
                <PaymentMethodsTab methods={data.methods} subs={data.subs} reload={refresh} />
              )}
              {tab === "settings" && <SettingsTab user={user} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function PortalSkeleton() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8 sm:py-10" aria-busy="true" aria-label="Loading portal">
      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <div className="hidden w-56 space-y-2 lg:block">
          <Skeleton className="h-16 rounded-2xl" />
          {PORTAL_TABS.map((t) => (
            <Skeleton key={t.key} className="h-11 rounded-xl" />
          ))}
        </div>
        <div className="space-y-6">
          <Skeleton className="h-24 rounded-2xl" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tab: Overview
// ============================================================================

function OverviewTab({
  user,
  data,
  goToTab,
}: {
  user: SessionUser;
  data: PortalData;
  goToTab: (t: PortalTab) => void;
}) {
  const { subs, invoices, grants } = data;
  const activeSubs = subs.filter((s) => s.status === "ACTIVE");
  const trialSubs = subs.filter((s) => s.status === "TRIALING");
  const monthlySpend = activeSubs.reduce((sum, s) => sum + monthlyCents(s.plan), 0);
  const paidInvoices = invoices.filter((i) => i.status === "PAID");
  const lifetimePaid = paidInvoices.reduce((sum, i) => sum + i.amountCents, 0);
  const activeGrants = grants.filter((g) => g.status === "SYNCED" && !g.revokedAt);
  const topSubs = sortSubs(subs).slice(0, 4);
  const recentInvoices = invoices.slice(0, 5);
  const firstName = (user.name || "there").split(" ")[0];

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-6">
      {/* Welcome header */}
      <motion.header
        variants={fadeUp}
        className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:p-6"
      >
        <UserAvatar name={user.name} color={user.avatarColor} size="lg" />
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Welcome back, {firstName}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Member since {fmtDate(user.createdAt)} · {user.email}
          </p>
        </div>
        <Button size="sm" className="ml-auto rounded-xl" onClick={() => goToTab("subscriptions")}>
          Manage billing <ChevronRight className="h-4 w-4" />
        </Button>
      </motion.header>

      {/* Stats */}
      <motion.div variants={fadeUp} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active memberships"
          value={String(activeSubs.length + trialSubs.length)}
          sub={`${activeSubs.length} paid · ${trialSubs.length} trialing`}
          icon={BadgeCheck}
        />
        <StatCard
          label="Monthly spend"
          value={fmtMoney(monthlySpend)}
          sub={activeSubs.length ? `across ${activeSubs.length} membership${activeSubs.length === 1 ? "" : "s"}` : "no recurring charges"}
          icon={Wallet}
        />
        <StatCard
          label="Lifetime paid"
          value={fmtMoney(lifetimePaid)}
          sub={`${paidInvoices.length} paid invoice${paidInvoices.length === 1 ? "" : "s"}`}
          icon={ReceiptText}
        />
        <StatCard
          label="Trial running"
          value={trialSubs.length ? String(trialSubs.length) : "—"}
          sub={trialSubs.length ? `first charge ${fmtDate(trialSubs[0].trialEndsAt)}` : "no trials running"}
          icon={Timer}
        />
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Memberships */}
        <motion.div variants={fadeUp} className="overflow-hidden lg:col-span-3">
          <Panel className="h-full">
            <div className="flex items-center justify-between gap-3 border-b p-5">
              <div>
                <h2 className="font-bold tracking-tight">Your memberships</h2>
                <p className="text-xs text-muted-foreground">{subs.length} total</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => goToTab("subscriptions")}>
                View all <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {topSubs.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={Repeat}
                  title="No memberships yet"
                  description="Browse the marketplace to join your first community."
                  action={
                    <Button className="rounded-xl" onClick={() => goToTab("subscriptions")}>
                      <Store className="h-4 w-4" /> Browse marketplace
                    </Button>
                  }
                />
              </div>
            ) : (
              <ul className="divide-y">
                {topSubs.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 p-4 sm:px-5">
                    <ProductCover
                      theme={s.product.coverTheme}
                      category={s.product.category}
                      title={s.product.title}
                      className="h-11 w-11 shrink-0 rounded-xl"
                      iconClassName="h-14 w-14"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-sm font-semibold">{s.product.title}</p>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {s.plan.name} · {nextChargeLine(s)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0 rounded-xl"
                      onClick={() => goToTab("subscriptions")}
                      aria-label={`Manage ${s.product.title} membership`}
                    >
                      Manage
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </motion.div>

        {/* Access & roles */}
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <Panel className="h-full p-5">
            <h2 className="font-bold tracking-tight">Access &amp; roles</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Community roles synced automatically by creator bots
            </p>
            {activeGrants.length === 0 ? (
              <p className="mt-6 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                No active community roles yet. They appear here when you join a product with Discord or
                Telegram access.
              </p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {activeGrants.map((g) => (
                  <li
                    key={g.id}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border bg-muted/30 px-3 py-2.5"
                  >
                    <ProviderBadge provider={g.provider} />
                    {g.role && <span className="text-sm font-medium">{g.role}</span>}
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{g.product.title}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                      {g.status.charAt(0) + g.status.slice(1).toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </motion.div>
      </div>

      {/* Recent invoices */}
      <motion.div variants={fadeUp}>
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="font-bold tracking-tight">Recent invoices</h2>
              <p className="text-xs text-muted-foreground">Last {recentInvoices.length} of {invoices.length}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => goToTab("invoices")}>
              View all <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {recentInvoices.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="divide-y">
              {recentInvoices.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{inv.product?.title || "Vendly"}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {inv.number} · {fmtDate(inv.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {fmtMoney(inv.amountCents, { cents: true })}
                  </span>
                  <StatusBadge status={inv.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </motion.div>
    </motion.section>
  );
}

// ============================================================================
// Tab: Subscriptions
// ============================================================================

interface SubCardProps {
  sub: SubscriptionDTO;
  methods: PaymentMethodDTO[];
  busy: boolean;
  onAction: (sub: SubscriptionDTO, action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  onChangePayment: (sub: SubscriptionDTO, pmId: string) => Promise<void>;
  onOpenTier: () => void;
  onCancel: (mode: "period_end" | "now") => void;
  onInvoices: () => void;
}

function SubscriptionCard({
  sub,
  methods,
  busy,
  onAction,
  onChangePayment,
  onOpenTier,
  onCancel,
  onInvoices,
}: SubCardProps) {
  const navigate = useAppStore((s) => s.navigate);
  const isActive = ACTIVE_STATUSES.includes(sub.status);
  const isTrial = sub.status === "TRIALING";
  const isCanceled = sub.status === "CANCELED";
  const isPastDue = sub.status === "PAST_DUE";
  const pm = sub.paymentMethod;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-sm transition-opacity",
        isCanceled && "bg-muted/40 opacity-75 shadow-none",
        isPastDue && "border-destructive/35"
      )}
    >
      <div className="flex flex-col gap-5 p-5 sm:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-4">
          <ProductCover
            theme={sub.product.coverTheme}
            category={sub.product.category}
            title={sub.product.title}
            className="h-14 w-14 shrink-0 rounded-xl"
            iconClassName="h-20 w-20"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-base font-bold tracking-tight">{sub.product.title}</h3>
              <StatusBadge status={sub.status} />
              {isTrial && sub.trialEndsAt && (
                <Badge
                  variant="outline"
                  className="gap-1 border-teal-500/25 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                >
                  <Timer className="h-3 w-3" aria-hidden />
                  Trial: {timeUntil(sub.trialEndsAt)} left
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              by {sub.product.creator.name || "Independent creator"} · {sub.plan.name} plan · member since{" "}
              {fmtDate(sub.createdAt)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <GatewayBadge gateway={sub.gateway} />
              {sub.product.accessType.map((a) => (
                <ProviderBadge key={a} provider={a} />
              ))}
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xl font-bold tabular-nums tracking-tight">{fmtMoney(sub.plan.priceCents)}</p>
            <p className="text-xs text-muted-foreground">per {sub.plan.interval}</p>
          </div>
        </div>

        {/* Period + payment method */}
        {isActive && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2.5 rounded-xl border bg-muted/30 p-4">
              <div className="flex items-center gap-2 text-sm">
                <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="text-muted-foreground">Current period</span>
                <span className="ml-auto font-medium tabular-nums">
                  {fmtDate(sub.currentPeriodStart)} → {fmtDate(sub.currentPeriodEnd)}
                </span>
              </div>
              {isTrial ? (
                <div className="flex items-center gap-2 text-sm">
                  <Timer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">First charge</span>
                  <span className="ml-auto font-medium tabular-nums">
                    {fmtMoney(sub.plan.priceCents)} · {fmtDate(sub.trialEndsAt)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="text-muted-foreground">Next charge</span>
                  <span className="ml-auto font-medium tabular-nums">
                    {fmtMoney(sub.plan.priceCents)} on {fmtDate(sub.currentPeriodEnd)}
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <CreditCard className="h-3.5 w-3.5" aria-hidden /> Payment method
                </p>
                {isPastDue && <span className="text-xs font-semibold text-destructive">Action needed</span>}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{pm ? pmShort(pm) : "No method on file"}</span>
                {methods.length > 0 && (
                  <Select value={pm?.id ?? ""} onValueChange={(v) => onChangePayment(sub, v)}>
                    <SelectTrigger
                      size="sm"
                      className="ml-auto h-8 rounded-lg text-xs"
                      aria-label={`Change payment method for ${sub.product.title}`}
                      disabled={busy}
                    >
                      <SelectValue placeholder="Select method" />
                    </SelectTrigger>
                    <SelectContent>
                      {methods.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {pmShort(m)}
                          {m.isDefault ? " · default" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {isPastDue
                  ? "Switch to a working method — the next billing run retries this charge automatically."
                  : "Changing the method applies to future renewals."}
              </p>
            </div>
          </div>
        )}

        {/* Banners */}
        {sub.cancelAtPeriodEnd && isActive && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <TriangleAlert className="h-4.5 w-4.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="min-w-0 flex-1 text-amber-800 dark:text-amber-300">
              <span className="font-semibold">Cancels at period end.</span> Access continues until{" "}
              {fmtDate(sub.currentPeriodEnd)}.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="rounded-lg border-amber-500/40 bg-transparent text-amber-800 hover:bg-amber-500/15 dark:text-amber-300"
              disabled={busy}
              onClick={() => onAction(sub, "resume")}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Resume
            </Button>
          </div>
        )}
        {isPastDue && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <TriangleAlert className="h-4.5 w-4.5 shrink-0 text-destructive" aria-hidden />
            <p className="min-w-0 flex-1 text-destructive">
              <span className="font-semibold">Payment failed.</span> {sub.dunningAttempts} dunning attempt
              {sub.dunningAttempts === 1 ? "" : "s"} so far — update the payment method above to retry.
            </p>
          </div>
        )}
        {isCanceled && (
          <p className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
            <CalendarX className="h-4 w-4 shrink-0" aria-hidden />
            Access ended {fmtDate(sub.currentPeriodEnd)} — community roles and license keys were revoked.
          </p>
        )}

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">
            {sub.invoiceCount} invoice{sub.invoiceCount === 1 ? "" : "s"} ·{" "}
            <span className="font-medium tabular-nums">{fmtMoney(sub.totalPaidCents)}</span> lifetime on this
            membership
          </p>
          {isCanceled ? (
            <Button
              size="sm"
              className="rounded-xl"
              onClick={() => navigate("product", { productId: sub.product.id })}
            >
              <Store className="h-4 w-4" /> Re-subscribe
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-xl" disabled={busy}>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Settings className="h-4 w-4" aria-hidden />
                  )}
                  Manage
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="gap-2" onClick={onOpenTier}>
                  <ArrowLeftRight className="h-4 w-4" aria-hidden /> Change tier…
                </DropdownMenuItem>
                <DropdownMenuItem className="gap-2" onClick={onInvoices}>
                  <ReceiptText className="h-4 w-4" aria-hidden /> View invoices
                </DropdownMenuItem>
                {sub.cancelAtPeriodEnd ? (
                  <DropdownMenuItem className="gap-2" onClick={() => onAction(sub, "resume")}>
                    <RotateCcw className="h-4 w-4" aria-hidden /> Resume subscription
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem className="gap-2" onClick={() => onCancel("period_end")}>
                    <CalendarX className="h-4 w-4" aria-hidden /> Cancel at period end…
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onClick={() => onCancel("now")}>
                  <Ban className="h-4 w-4" aria-hidden /> Cancel immediately…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </article>
  );
}

function SubscriptionsTab({
  data,
  reload,
  goToInvoices,
}: {
  data: PortalData;
  reload: () => void;
  goToInvoices: (subId: string) => void;
}) {
  const { toast } = useToast();
  const navigate = useAppStore((s) => s.navigate);
  const { subs, methods } = data;

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tierSub, setTierSub] = useState<SubscriptionDTO | null>(null);
  const [tierPlans, setTierPlans] = useState<PlanDTO[] | null>(null);
  const [tierPlanId, setTierPlanId] = useState<string | null>(null);
  const [cancelMode, setCancelMode] = useState<{ sub: SubscriptionDTO; mode: "period_end" | "now" } | null>(null);
  const plansCache = useRef<Record<string, PlanDTO[]>>({});

  // Invalidate plan cache whenever subscription data refreshes.
  useEffect(() => {
    plansCache.current = {};
  }, [subs]);

  function openTier(sub: SubscriptionDTO) {
    setTierPlanId(null);
    setTierPlans(plansCache.current[sub.product.id] ?? null);
    setTierSub(sub);
  }

  function closeTier() {
    setTierSub(null);
    setTierPlans(null);
    setTierPlanId(null);
  }

  // Fetch plans for the "Change tier" dialog when a cache miss was staged.
  useEffect(() => {
    if (!tierSub || tierPlans) return;
    const pid = tierSub.product.id;
    let alive = true;
    const load = async () => {
      try {
        const res = await api<{ product: ProductDetailDTO }>(`/api/products/${pid}`);
        if (!alive) return;
        plansCache.current[pid] = res.product.plans;
        setTierPlans(res.product.plans);
      } catch {
        if (!alive) return;
        toast({ title: "Couldn't load plans", description: "Please try again.", variant: "destructive" });
        closeTier();
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [tierSub, tierPlans, toast]);

  async function runSubAction(
    sub: SubscriptionDTO,
    action: string,
    extra: Record<string, unknown> = {},
    successTitle = "Subscription updated"
  ): Promise<boolean> {
    setBusyKey(`${sub.id}:${action}`);
    try {
      const res = await api<{ ok: boolean; message: string }>(`/api/subscriptions/${sub.id}`, {
        method: "PATCH",
        json: { action, ...extra },
      });
      toast({ title: successTitle, description: res.message });
      reload();
      return true;
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function changePaymentMethod(sub: SubscriptionDTO, pmId: string) {
    if (pmId === sub.paymentMethod?.id) return;
    setBusyKey(`${sub.id}:update_payment`);
    try {
      const res = await api<{ ok: boolean; message: string }>(`/api/subscriptions/${sub.id}`, {
        method: "PATCH",
        json: { action: "update_payment", paymentMethodId: pmId },
      });
      toast({
        title: "Payment method updated",
        description:
          sub.status === "PAST_DUE"
            ? `${res.message} The next billing run will retry the failed charge automatically.`
            : res.message,
      });
      reload();
    } catch (e) {
      toast({
        title: "Couldn't update payment method",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  const activeCount = subs.filter((s) => s.status === "ACTIVE").length;
  const trialCount = subs.filter((s) => s.status === "TRIALING").length;
  const sorted = useMemo(() => sortSubs(subs), [subs]);

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={fadeUp}>
        <SectionHeader
          title="Memberships"
          description={`${activeCount} active · ${trialCount} trialing · ${subs.length - activeCount - trialCount} ended`}
        />
      </motion.div>

      {sorted.map((sub) => (
        <motion.div key={sub.id} variants={fadeUp}>
          <SubscriptionCard
            sub={sub}
            methods={methods}
            busy={!!busyKey && busyKey.startsWith(`${sub.id}:`)}
            onAction={runSubAction}
            onChangePayment={changePaymentMethod}
            onOpenTier={() => openTier(sub)}
            onCancel={(mode) => setCancelMode({ sub, mode })}
            onInvoices={() => goToInvoices(sub.id)}
          />
        </motion.div>
      ))}

      {subs.length === 0 && (
        <motion.div variants={fadeUp}>
          <EmptyState
            icon={Repeat}
            title="No memberships yet"
            description="Browse the marketplace and join your first community or grab a digital product."
            action={
              <Button className="rounded-xl" onClick={() => navigate("discover")}>
                <Store className="h-4 w-4" /> Browse marketplace
              </Button>
            }
          />
        </motion.div>
      )}

      {/* ---- Change tier dialog ---- */}
      <Dialog open={!!tierSub} onOpenChange={(o) => !o && closeTier()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change tier</DialogTitle>
            <DialogDescription>
              {tierSub
                ? `${tierSub.product.title} — pick a new plan. Unused time on your current plan is credited via proration.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {!tierPlans ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[88px] rounded-xl" />
              ))}
            </div>
          ) : tierPlans.filter((p) => p.id !== tierSub?.plan.id).length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              This product only offers one tier right now.
            </p>
          ) : (
            <div className="grid gap-2" role="radiogroup" aria-label="Available plans">
              {tierPlans.map((plan) => {
                const current = plan.id === tierSub?.plan.id;
                const selected = plan.id === tierPlanId;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={current}
                    onClick={() => setTierPlanId(plan.id)}
                    className={cn(
                      "rounded-xl border p-4 text-left transition-all",
                      selected ? "border-primary bg-primary/5 ring-2 ring-primary/25" : "hover:bg-muted/40",
                      current && "cursor-default opacity-60"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{plan.name}</span>
                        {current && (
                          <Badge variant="secondary" className="text-[10px]">
                            Current
                          </Badge>
                        )}
                        {plan.badge && (
                          <Badge variant="outline" className="border-primary/30 text-[10px] text-primary">
                            {plan.badge}
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm font-bold tabular-nums">
                        {fmtMoney(plan.priceCents)}
                        <span className="text-xs font-normal text-muted-foreground">/{plan.interval}</span>
                      </span>
                    </div>
                    {plan.description && <p className="mt-1 text-xs text-muted-foreground">{plan.description}</p>}
                    {plan.features.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {plan.features.slice(0, 3).join(" · ")}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeTier}>
              Close
            </Button>
            <Button
              disabled={!tierPlanId || !!busyKey}
              onClick={async () => {
                if (!tierSub || !tierPlanId) return;
                const ok = await runSubAction(tierSub, "change_plan", { planId: tierPlanId }, "Tier changed");
                if (ok) closeTier();
              }}
            >
              Confirm change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Cancel dialog ---- */}
      <AlertDialog open={!!cancelMode} onOpenChange={(o) => !o && setCancelMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cancelMode?.mode === "now" ? "Cancel immediately?" : "Cancel at period end?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancelMode?.mode === "now"
                ? `${cancelMode.sub.product.title} — this ends your membership right now. You will instantly lose access to communities, files and downloads, and your license keys for this product will be revoked. This cannot be undone.`
                : `${cancelMode?.sub.product.title} — your membership stays active until ${fmtDate(
                    cancelMode?.sub.currentPeriodEnd ?? null
                  )}, then cancels automatically. You keep full access until then.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep membership</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault(); // stay open until the request finishes
                if (!cancelMode) return;
                const ok = await runSubAction(
                  cancelMode.sub,
                  cancelMode.mode === "now" ? "cancel_now" : "cancel",
                  {},
                  cancelMode.mode === "now" ? "Membership canceled" : "Cancellation scheduled"
                );
                if (ok) setCancelMode(null);
              }}
            >
              {cancelMode?.mode === "now" ? "Cancel now" : "Schedule cancellation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.section>
  );
}

// ============================================================================
// Tab: Licenses
// ============================================================================

type ValidateOK = {
  valid: true;
  product: { id: string; title: string };
  plan: string | null;
  activations: number;
  maxActivations: number;
  lastUsedAt: string | null;
};
type ValidateResult = ValidateOK | { valid: false; reason: string };

const VALIDATE_REASONS: Record<string, string> = {
  NOT_FOUND: "No license matches this key — check for typos.",
  REVOKED: "This license was revoked by the customer.",
  SUBSCRIPTION_INACTIVE: "The membership linked to this key is no longer active.",
};

function LicensesTab({ licenses, reload }: { licenses: LicenseDTO[]; reload: () => void }) {
  const { toast } = useToast();
  const [keyInput, setKeyInput] = useState("WHPL-7K2M-QX9R-4T8V");
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<LicenseDTO | null>(null);

  async function handleValidate(e: FormEvent) {
    e.preventDefault();
    const key = keyInput.trim().toUpperCase();
    if (!key) return;
    setValidating(true);
    setResult(null);
    try {
      const res = await api<ValidateOK | { valid: false; reason: string }>("/api/licenses/validate", {
        json: { key },
      });
      setResult(res.valid ? res : { valid: false, reason: res.reason });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setResult({ valid: false, reason: "NOT_FOUND" });
      } else {
        toast({
          title: "Validation failed",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setValidating(false);
    }
  }

  async function activate(lic: LicenseDTO) {
    setBusyId(lic.id);
    try {
      const res = await api<{ ok: boolean; activations: number; maxActivations: number; device: string }>(
        `/api/licenses/${lic.id}/activate`,
        { method: "POST", json: {} }
      );
      toast({
        title: `Activated on ${res.device}`,
        description: `${res.activations} of ${res.maxActivations} device activations used.`,
      });
      reload();
    } catch (e) {
      toast({
        title: "Activation failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function revoke() {
    if (!revokeTarget) return;
    setBusyId(revokeTarget.id);
    try {
      await api(`/api/licenses/${revokeTarget.id}/activate`, { method: "DELETE" });
      toast({
        title: "License revoked",
        description: `${revokeTarget.product.title} — the key no longer validates.`,
      });
      setRevokeTarget(null);
      reload();
    } catch (e) {
      toast({
        title: "Revoke failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={fadeUp}>
        <SectionHeader
          title="License keys"
          description="Software keys issued with your memberships — activate devices, validate installs, revoke anytime."
        />
      </motion.div>

      {/* ---- Validate a key (public API demo) ---- */}
      <motion.div variants={fadeUp}>
        <Panel className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <ShieldCheck className="h-4.5 w-4.5 text-primary" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight">Validate a key</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                This calls the same public endpoint (<code className="font-mono">POST /api/licenses/validate</code>)
                that a downloaded app would use to verify an install.
              </p>
            </div>
          </div>
          <form onSubmit={handleValidate} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
              placeholder="WHPL-XXXX-XXXX-XXXX"
              className="rounded-xl font-mono tracking-wider"
              aria-label="License key to validate"
            />
            <Button type="submit" className="rounded-xl" disabled={validating || !keyInput.trim()}>
              {validating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
              Validate
            </Button>
          </form>
          {result && (
            <div
              className={cn(
                "mt-4 rounded-xl border p-4",
                result.valid
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-destructive/30 bg-destructive/10"
              )}
              role="status"
            >
              <p
                className={cn(
                  "flex items-center gap-2 text-sm font-semibold",
                  result.valid ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
                )}
              >
                {result.valid ? (
                  <>
                    <CircleCheck className="h-4 w-4" aria-hidden /> Valid license
                  </>
                ) : (
                  <>
                    <CircleX className="h-4 w-4" aria-hidden /> Invalid license
                  </>
                )}
              </p>
              {result.valid ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Product</dt>
                    <dd className="mt-0.5 font-medium">{result.product.title}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="mt-0.5 font-medium">{result.plan || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Activations</dt>
                    <dd className="mt-0.5 font-medium tabular-nums">
                      {result.activations} of {result.maxActivations}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Last used</dt>
                    <dd className="mt-0.5 font-medium">{result.lastUsedAt ? timeAgo(result.lastUsedAt) : "never"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-1.5 text-xs text-destructive">
                  {VALIDATE_REASONS[result.reason] || result.reason}
                </p>
              )}
            </div>
          )}
        </Panel>
      </motion.div>

      {/* ---- License cards ---- */}
      {licenses.length === 0 ? (
        <motion.div variants={fadeUp}>
          <EmptyState
            icon={KeyRound}
            title="No license keys yet"
            description="Keys are issued automatically when you purchase a product with license-key access."
          />
        </motion.div>
      ) : (
        licenses.map((lic) => {
          const revealed = revealedId === lic.id;
          const pct = Math.min(100, Math.round((lic.activations / Math.max(1, lic.maxActivations)) * 100));
          const revoked = lic.status === "REVOKED";
          return (
            <motion.div key={lic.id} variants={fadeUp}>
              <Panel className={cn("p-5 sm:p-6", revoked && "border-destructive/30 bg-destructive/5")}>
                <div className="flex flex-wrap items-start gap-4">
                  <ProductCover
                    theme={lic.product.coverTheme}
                    category="OTHER"
                    title={lic.product.title}
                    className="h-12 w-12 shrink-0 rounded-xl"
                    iconClassName="h-16 w-16"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold tracking-tight">{lic.product.title}</h3>
                      <StatusBadge status={lic.status} />
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {lic.planName || "Licensed product"} · issued {fmtDate(lic.createdAt)}
                    </p>
                  </div>
                  <div className="text-left text-xs text-muted-foreground sm:text-right">
                    <p>Activated {lic.activatedAt ? fmtDate(lic.activatedAt) : "never"}</p>
                    <p className="mt-0.5">Last used {lic.lastUsedAt ? timeAgo(lic.lastUsedAt) : "never"}</p>
                  </div>
                </div>

                {/* Key with reveal + copy */}
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2.5">
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <code className="min-w-0 flex-1 truncate font-mono text-sm tracking-wider">
                    {revealed ? lic.key : maskKey(lic.key)}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setRevealedId(revealed ? null : lic.id)}
                    aria-label={revealed ? "Hide license key" : "Reveal license key"}
                  >
                    {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </Button>
                  {revealed && <CopyButton value={lic.key} label="Copy" />}
                </div>

                {/* Activations */}
                {!revoked && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {lic.activations} of {lic.maxActivations} device activations used
                      </span>
                      <span className="font-semibold tabular-nums">{pct}%</span>
                    </div>
                    <Progress value={pct} className="mt-1.5 h-2" aria-label="Device activation usage" />
                  </div>
                )}

                {/* Actions */}
                <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
                  {!revoked ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl"
                        disabled={busyId === lic.id || lic.activations >= lic.maxActivations}
                        onClick={() => activate(lic)}
                      >
                        {busyId === lic.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <MonitorSmartphone className="h-4 w-4" aria-hidden />
                        )}
                        Activate on new device
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={busyId === lic.id}
                        onClick={() => setRevokeTarget(lic)}
                      >
                        <Ban className="h-4 w-4" aria-hidden /> Revoke license
                      </Button>
                      {lic.activations >= lic.maxActivations && (
                        <span className="text-xs text-amber-600 dark:text-amber-400">
                          Device limit reached — revoke or upgrade to activate more.
                        </span>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-destructive">
                      This key was revoked and no longer validates. Re-purchase the product to get a new one.
                    </p>
                  )}
                </div>
              </Panel>
            </motion.div>
          );
        })
      )}

      {/* ---- Revoke confirm ---- */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this license?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget
                ? `${revokeTarget.product.title} — the key ${maskKey(revokeTarget.key)} will stop validating immediately. Apps using it will lose access. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep license</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={busyId === revokeTarget?.id}
              onClick={(e) => {
                e.preventDefault();
                void revoke();
              }}
            >
              {busyId === revokeTarget?.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.section>
  );
}

// ============================================================================
// Tab: Downloads
// ============================================================================

function DownloadsTab({ subs }: { subs: SubscriptionDTO[] }) {
  const { toast } = useToast();
  const navigate = useAppStore((s) => s.navigate);
  const [products, setProducts] = useState<Record<string, ProductDetailDTO>>({});
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const eligible = useMemo(() => subs.filter((s) => ["ACTIVE", "TRIALING"].includes(s.status)), [subs]);

  // Fetch product details (incl. assets) for every active membership.
  // All state updates happen asynchronously (after the fetch settles).
  useEffect(() => {
    let alive = true;
    const ids = [...new Set(eligible.map((s) => s.product.id))];
    const load = async () => {
      if (ids.length === 0) {
        if (!alive) return;
        setProducts({});
        setLoading(false);
        return;
      }
      const list = await Promise.all(
        ids.map((id) =>
          api<{ product: ProductDetailDTO }>(`/api/products/${id}`)
            .then((r) => r.product)
            .catch(() => null)
        )
      );
      if (!alive) return;
      const map: Record<string, ProductDetailDTO> = {};
      list.forEach((p) => {
        if (p) map[p.id] = p;
      });
      setProducts(map);
      setLoading(false);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [eligible]);

  const groups = eligible
    .map((sub) => ({ sub, product: products[sub.product.id] }))
    .filter((g) => g.product && g.product.assets.length > 0);

  async function download(assetId: string, productId: string) {
    setDownloadingId(assetId);
    try {
      const res = await api<{ url: string; expiresIn: number; maxUses: number; fileName: string }>(
        `/api/assets/${assetId}/link`,
        { method: "POST", json: {} }
      );
      window.open(res.url, "_blank");
      toast({
        title: "Secure link opened",
        description: `${res.fileName} — valid ${Math.round(res.expiresIn / 60)} min, up to ${res.maxUses} uses.`,
      });
      // Refresh the product so the download counter updates.
      try {
        const fresh = await api<{ product: ProductDetailDTO }>(`/api/products/${productId}`);
        setProducts((prev) => ({ ...prev, [productId]: fresh.product }));
      } catch {
        /* counter refresh is best-effort */
      }
    } catch (e) {
      toast({
        title: "Download blocked",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={fadeUp}>
        <SectionHeader
          title="Downloads"
          description="Secure digital asset delivery for your active memberships."
        />
      </motion.div>

      <motion.div
        variants={fadeUp}
        className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4"
      >
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <p className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
          <span className="font-semibold">Secure delivery.</span> Every download mints a single-use expiring
          token tied to your membership — links stay valid for 10 minutes and up to 3 uses.
        </p>
      </motion.div>

      {loading ? (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : eligible.length === 0 ? (
        <motion.div variants={fadeUp}>
          <EmptyState
            icon={Download}
            title="No active memberships"
            description="Files unlock as soon as you join a product with file access."
            action={
              <Button className="rounded-xl" onClick={() => navigate("discover")}>
                <Store className="h-4 w-4" /> Browse marketplace
              </Button>
            }
          />
        </motion.div>
      ) : groups.length === 0 ? (
        <motion.div variants={fadeUp}>
          <EmptyState
            icon={FileDown}
            title="No files in your memberships yet"
            description="Your current memberships don't include file downloads. Products with a file vault will appear here."
            action={
              <Button className="rounded-xl" onClick={() => navigate("discover")}>
                <Store className="h-4 w-4" /> Browse marketplace
              </Button>
            }
          />
        </motion.div>
      ) : (
        groups.map(({ sub, product }) => (
          <motion.div key={sub.id} variants={fadeUp}>
            <Panel className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b p-5">
                <ProductCover
                  theme={product.coverTheme}
                  category={product.category}
                  title={product.title}
                  className="h-11 w-11 shrink-0 rounded-xl"
                  iconClassName="h-14 w-14"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold tracking-tight">{product.title}</h3>
                    <StatusBadge status={sub.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {sub.plan.name} · {product.assets.length} file{product.assets.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <ul className="divide-y">
                {product.assets.map((asset) => {
                  const Icon = fileIcon(asset.mimeType);
                  return (
                    <li key={asset.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-5">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
                        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{asset.name}</p>
                          <Badge variant="outline" className="text-[10px] tabular-nums">
                            v{asset.version}
                          </Badge>
                          {asset.requiresLicense && (
                            <Badge
                              variant="outline"
                              className="gap-1 border-amber-500/25 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                            >
                              <Lock className="h-3 w-3" aria-hidden /> License required
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {asset.fileName} · {fmtBytes(asset.sizeBytes)} · downloaded{" "}
                          <span className="tabular-nums">{asset.downloadCount}</span>{" "}
                          {asset.downloadCount === 1 ? "time" : "times"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 rounded-xl"
                        disabled={downloadingId === asset.id}
                        onClick={() => download(asset.id, product.id)}
                        aria-label={`Download ${asset.name}`}
                      >
                        {downloadingId === asset.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : (
                          <Download className="h-4 w-4" aria-hidden />
                        )}
                        Download
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </motion.div>
        ))
      )}
    </motion.section>
  );
}

// ============================================================================
// Tab: Wishlist
// ============================================================================

/** Cheapest monthly plan ("from $X/mo"), falling back to the cheapest yearly
 *  plan ("/yr") — the same rule the marketplace product cards use. */
function wishlistFromPrice(product: ProductCardDTO): { cents: number; suffix: string } | null {
  const active = product.plans.filter((p) => p.active);
  const monthly = active.filter((p) => p.interval === "month");
  if (monthly.length > 0) return { cents: Math.min(...monthly.map((p) => p.priceCents)), suffix: "/mo" };
  const yearly = active.filter((p) => p.interval === "year");
  if (yearly.length > 0) return { cents: Math.min(...yearly.map((p) => p.priceCents)), suffix: "/yr" };
  return null;
}

function WishlistStars({ value, count }: { value: number; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="img" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      <span className="flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(
              "h-3.5 w-3.5",
              i <= Math.round(value)
                ? "fill-amber-400 text-amber-400"
                : "fill-muted-foreground/15 text-muted-foreground/30"
            )}
          />
        ))}
      </span>
      <span className="text-xs text-muted-foreground">({fmtCompact(count)})</span>
    </span>
  );
}

function WishlistCard({
  item,
  index,
  isMember,
  removing,
  onRemove,
}: {
  item: WishlistItemDTO;
  index: number;
  isMember: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const navigate = useAppStore((s) => s.navigate);
  const product = item.product;
  const price = wishlistFromPrice(product);
  const categoryLabel = CATEGORIES.find((c) => c.key === product.category)?.label ?? product.category;
  const viewProduct = () => navigate("product", { productId: product.id });

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18, ease: "easeIn" } }}
      transition={{
        opacity: { duration: 0.25, delay: Math.min(index * 0.06, 0.36) },
        y: { duration: 0.3, ease: "easeOut", delay: Math.min(index * 0.06, 0.36) },
        layout: { type: "spring", stiffness: 350, damping: 32 },
      }}
      className="h-full"
    >
      {/* Clickable card: everything except the remove button opens the product. */}
      <div
        onClick={viewProduct}
        className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-within:ring-2 focus-within:ring-emerald-500/40"
      >
        {/* Cover */}
        <div className="relative overflow-hidden">
          <ProductCover
            theme={product.coverTheme}
            category={product.category}
            title={product.title}
            className="aspect-video w-full transition-transform duration-300 group-hover:scale-105"
            iconClassName="h-24 w-24"
          />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
            <CategoryIcon category={product.category} className="h-3 w-3" aria-hidden />
            {categoryLabel}
          </span>
          {isMember && (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-600/95 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-sm">
              <BadgeCheck className="h-3 w-3" aria-hidden /> You're a member
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-center gap-2">
            <UserAvatar name={product.creator.name} color={product.creator.avatarColor} size="sm" />
            <span className="truncate text-xs font-medium text-muted-foreground">
              {product.creator.name ?? "Creator"}
            </span>
          </div>
          <div>
            <h3 className="text-[15px] font-semibold tracking-tight">{product.title}</h3>
            {product.tagline && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{product.tagline}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <WishlistStars value={product.rating} count={product.reviewCount} />
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden />
              {fmtCompact(product.membersCount)} members
            </span>
          </div>
          {product.accessType.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {product.accessType.map((a) => (
                <ProviderBadge key={a} provider={a} />
              ))}
            </div>
          )}

          {/* Price, saved caption + actions */}
          <div className="mt-auto space-y-3 border-t pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              {price ? (
                <p className="text-sm">
                  <span className="text-xs text-muted-foreground">from </span>
                  <span className="text-base font-bold tabular-nums">{fmtMoney(price.cents)}</span>
                  <span className="text-xs text-muted-foreground">{price.suffix}</span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Free</p>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Heart className="h-3 w-3 fill-emerald-500/60 text-emerald-500/60" aria-hidden />
                Saved {timeAgo(item.createdAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                className="h-11 flex-1 rounded-xl"
                onClick={(e) => {
                  e.stopPropagation();
                  viewProduct();
                }}
              >
                View product
              </Button>
              <Button
                variant="ghost"
                className="h-11 w-11 shrink-0 rounded-xl px-0 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                disabled={removing}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                aria-label={`Remove ${product.title} from wishlist`}
                title="Remove from wishlist"
              >
                {removing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <HeartOff className="h-4 w-4" aria-hidden />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function WishlistTab({
  items,
  subs,
  onRemove,
}: {
  items: WishlistItemDTO[];
  subs: SubscriptionDTO[];
  onRemove: (productId: string) => Promise<void>;
}) {
  const { toast } = useToast();
  const navigate = useAppStore((s) => s.navigate);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Products the member currently holds a membership for (incl. trials & past-due).
  const ownedProductIds = useMemo(
    () => new Set(subs.filter((s) => ACTIVE_STATUSES.includes(s.status)).map((s) => s.product.id)),
    [subs]
  );

  async function remove(item: WishlistItemDTO) {
    setRemovingId(item.product.id);
    try {
      await onRemove(item.product.id);
      toast({
        title: "Removed from wishlist",
        description: `${item.product.title} was unsaved.`,
      });
    } catch (e) {
      toast({
        title: "Couldn't update wishlist",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={fadeUp}>
        <SectionHeader
          title="Wishlist"
          description="Products you saved for later."
          action={
            <Badge variant="secondary" className="rounded-full px-3 tabular-nums">
              {items.length} {items.length === 1 ? "item" : "items"}
            </Badge>
          }
        />
      </motion.div>

      {/* Grid ↔ empty swap: when the last card is removed the grid fades out
          first (mode="wait"), then the empty state eases in. */}
      <AnimatePresence mode="wait">
        {items.length === 0 ? (
          <motion.div
            key="wishlist-empty"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <EmptyState
              icon={Heart}
              title="Your wishlist is empty"
              description="Browse the marketplace and tap the heart on any product to save it for later."
              action={
                <Button className="rounded-xl" onClick={() => navigate("discover")}>
                  <Store className="h-4 w-4" /> Browse marketplace
                </Button>
              }
            />
          </motion.div>
        ) : (
          <motion.div
            key="wishlist-grid"
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="relative grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {/* popLayout: the exiting card lifts out of the grid so the
                remaining cards reflow immediately with layout springs. */}
            <AnimatePresence mode="popLayout">
              {items.map((item, index) => (
                <WishlistCard
                  key={item.id}
                  item={item}
                  index={index}
                  isMember={ownedProductIds.has(item.product.id)}
                  removing={removingId === item.product.id}
                  onRemove={() => remove(item)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

// ============================================================================
// Tab: Affiliates
// ============================================================================

/** Referral landing URL — the format the marketplace landing flow reads
 *  (?ref + ?product are picked up once, stored in sessionStorage, click-tracked,
 *  then the visitor is taken to the product page). */
function referralUrl(link: AffiliateLinkDTO): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/?ref=${link.code}&product=${link.product.id}`;
}

/** 3000 bps → "30" (kept precise for non-whole rates, e.g. 2550 → "25.5"). */
function bpsPercent(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

function AffiliateLinkCard({ link, index }: { link: AffiliateLinkDTO; index: number }) {
  const { toast } = useToast();
  const navigate = useAppStore((s) => s.navigate);
  const [copied, setCopied] = useState(false);
  const url = referralUrl(link);
  const rate = link.clicks > 0 ? (link.conversions / link.clicks) * 100 : null;
  const viewProduct = () => navigate("product", { productId: link.product.id });

  function copyLink() {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    toast({
      title: "Referral link copied",
      description: `Share “${link.product.title}” — subscriptions through your link earn you ${bpsPercent(
        link.commissionBps
      )}%.`,
    });
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        opacity: { duration: 0.25, delay: Math.min(index * 0.06, 0.36) },
        y: { duration: 0.3, ease: "easeOut", delay: Math.min(index * 0.06, 0.36) },
      }}
      className="h-full"
    >
      <div className="group flex h-full flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg focus-within:ring-2 focus-within:ring-emerald-500/40">
        {/* Cover with the commission badge */}
        <div className="relative overflow-hidden">
          <ProductCover
            theme={link.product.coverTheme}
            category="OTHER"
            title={link.product.title}
            className="aspect-[16/8] w-full transition-transform duration-300 group-hover:scale-105"
            iconClassName="h-24 w-24"
          />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm backdrop-blur-sm">
            <Banknote className="h-3 w-3" aria-hidden /> Earn {bpsPercent(link.commissionBps)}%
          </span>
          {!link.active && (
            <span className="absolute right-3 top-3 inline-flex items-center rounded-full bg-amber-500/95 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm backdrop-blur-sm">
              Paused
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-3 p-4">
          {/* Creator + product */}
          <div className="flex items-center gap-2">
            <UserAvatar name={link.product.creator.name} color={link.product.creator.avatarColor} size="sm" />
            <span className="truncate text-xs font-medium text-muted-foreground">
              {link.product.creator.name ?? "Creator"}
            </span>
          </div>
          <button
            type="button"
            onClick={viewProduct}
            className="w-fit rounded-sm text-left text-[15px] font-semibold tracking-tight hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            {link.product.title}
          </button>

          {/* Referral link + copy/open */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Your referral link
            </p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Input
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
                title={url}
                aria-label={`Referral link for ${link.product.title}`}
                className="h-11 min-w-0 flex-1 rounded-xl bg-muted/40 font-mono text-xs text-muted-foreground focus-visible:border-emerald-500/50 focus-visible:ring-emerald-500/30"
              />
              <Button
                variant="outline"
                className="h-11 w-11 shrink-0 rounded-xl px-0"
                onClick={copyLink}
                aria-label={`Copy referral link for ${link.product.title}`}
                title="Copy referral link"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-500" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
              </Button>
              <Button
                variant="ghost"
                className="h-11 w-11 shrink-0 rounded-xl px-0 text-muted-foreground"
                onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                aria-label={`Open the referral landing page for ${link.product.title} in a new tab`}
                title="Open referral landing page"
              >
                <ExternalLink className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </div>

          {/* Performance mini-grid */}
          <div className="grid grid-cols-3 rounded-xl border bg-muted/30 py-2.5 text-center">
            <div className="px-2">
              <p className="text-sm font-bold tabular-nums">{fmtCompact(link.clicks)}</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Clicks</p>
            </div>
            <div className="border-x px-2">
              <p className="text-sm font-bold tabular-nums">{link.conversions}</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Conversions
              </p>
            </div>
            <div className="px-2">
              <p className="text-sm font-bold tabular-nums">{rate != null ? `${rate.toFixed(1)}%` : "—"}</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Conv. rate
              </p>
            </div>
          </div>

          {/* Earnings + joined */}
          <div className="mt-auto space-y-1.5 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Banknote className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> Paid
                <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {fmtMoney(link.earnedPaidCents, { cents: true })}
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Timer className="h-3.5 w-3.5 text-amber-500" aria-hidden /> Pending
                <span className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {fmtMoney(link.earnedPendingCents, { cents: true })}
                </span>
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">Joined {timeAgo(link.createdAt)}</p>
          </div>
        </div>
      </div>
    </motion.article>
  );
}

function HowItWorksDialog({
  open,
  onOpenChange,
  commissionLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commissionLabel: string | null;
}) {
  const steps = [
    {
      icon: Share2,
      title: "Share your link",
      body: "Grab your referral link from any product with an affiliate program and post it anywhere — socials, DMs, your community.",
    },
    {
      icon: UserPlus,
      title: "Someone subscribes",
      body: "When a new member checks out through your link, the sale is automatically attributed to you.",
    },
    {
      icon: Banknote,
      title: commissionLabel
        ? `You earn ${commissionLabel} of their first invoice`
        : "You earn a share of their first invoice",
      body: "The commission starts as pending and settles to paid on the next billing run.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How affiliate links work</DialogTitle>
          <DialogDescription>
            Earn commissions by sharing products you love — three steps, zero setup.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-5">
          {steps.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <step.icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                  Step {i + 1}
                </p>
                <p className="mt-0.5 text-sm font-semibold leading-snug">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <DialogFooter>
          <Button className="rounded-xl" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AffiliatesTab({ links }: { links: AffiliateLinkDTO[] }) {
  const navigate = useAppStore((s) => s.navigate);
  const [howOpen, setHowOpen] = useState(false);

  // Newest programs first.
  const sorted = useMemo(
    () => [...links].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [links]
  );

  const paid = links.reduce((sum, l) => sum + l.earnedPaidCents, 0);
  const pending = links.reduce((sum, l) => sum + l.earnedPendingCents, 0);
  const clicks = links.reduce((sum, l) => sum + l.clicks, 0);
  const conversions = links.reduce((sum, l) => sum + l.conversions, 0);
  const rate = clicks > 0 ? (conversions / clicks) * 100 : null;

  // Commission copy for the "How it works" dialog: exact when uniform,
  // "up to" the best rate when the member's programs differ.
  const rates = new Set(links.map((l) => l.commissionBps));
  const topBps = links.length ? Math.max(...links.map((l) => l.commissionBps)) : null;
  const commissionLabel =
    topBps == null ? null : rates.size > 1 ? `up to ${bpsPercent(topBps)}%` : `${bpsPercent(topBps)}%`;

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={fadeUp}>
        <SectionHeader
          title="Affiliates"
          description="Earn commissions by sharing products you love."
          action={
            <Button variant="ghost" className="rounded-xl" onClick={() => setHowOpen(true)}>
              <Info className="h-4 w-4" aria-hidden /> How it works
            </Button>
          }
        />
      </motion.div>

      {links.length === 0 ? (
        <motion.div variants={fadeUp}>
          <EmptyState
            icon={Share2}
            title="You're not promoting anything yet"
            description="Find a product with an affiliate program on its page and grab your link."
            action={
              <Button className="rounded-xl" onClick={() => navigate("discover")}>
                <Store className="h-4 w-4" aria-hidden /> Browse marketplace
              </Button>
            }
          />
        </motion.div>
      ) : (
        <>
          {/* Performance summary */}
          <motion.div variants={fadeUp} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Paid earnings"
              value={fmtMoney(paid, { cents: true })}
              sub={`across ${links.length} program${links.length === 1 ? "" : "s"}`}
              icon={Banknote}
            />
            <StatCard
              label="Pending earnings"
              value={fmtMoney(pending, { cents: true })}
              sub="settles on the next billing run"
              icon={Timer}
              className="border-amber-500/30 bg-amber-500/[0.05] [&>div>div]:bg-amber-500/10 [&>div>div>svg]:text-amber-600 dark:[&>div>div>svg]:text-amber-400"
            />
            <StatCard
              label="Total clicks"
              value={fmtCompact(clicks)}
              sub="tracked visits to your links"
              icon={MousePointerClick}
            />
            <StatCard
              label="Conversions"
              value={String(conversions)}
              sub={rate != null ? `${rate.toFixed(1)}% conversion rate` : "no clicks yet"}
              icon={Target}
            />
          </motion.div>

          {/* Link cards */}
          <motion.div variants={fadeUp} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map((link, index) => (
              <AffiliateLinkCard key={link.id} link={link} index={index} />
            ))}
          </motion.div>
        </>
      )}

      <HowItWorksDialog open={howOpen} onOpenChange={setHowOpen} commissionLabel={commissionLabel} />
    </motion.section>
  );
}

// ============================================================================
// Tab: Invoices
// ============================================================================

function downloadReceipt(inv: InvoiceDTO, email: string | null) {
  const money = fmtMoney(inv.amountCents, { cents: true });
  const lines = [
    "================================================",
    "  VENDLY - PAYMENT RECEIPT",
    "================================================",
    "",
    `Invoice number : ${inv.number}`,
    `Status         : ${inv.status}`,
    `Description    : ${inv.description}`,
    `Product        : ${inv.product?.title ?? "-"}`,
    `Amount         : ${money}`,
    `Gateway        : ${inv.gateway ?? "-"}`,
    `Issued         : ${fmtDateTime(inv.createdAt)}`,
    `Paid           : ${inv.paidAt ? fmtDateTime(inv.paidAt) : "-"}`,
    `Period         : ${
      inv.periodStart ? `${fmtDate(inv.periodStart)} - ${fmtDate(inv.periodEnd)}` : "-"
    }`,
    `Billed to      : ${email ?? "-"}`,
    "",
    "Payments are simulated in this demo environment.",
    "No real charges were made.",
    "",
    "Thank you for being a Vendly member!",
    "================================================",
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vendly-receipt-${inv.number}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function InvoicesTab({
  invoices,
  subs,
  subFilter,
  onSubFilterChange,
  user,
}: {
  invoices: InvoiceDTO[];
  subs: SubscriptionDTO[];
  subFilter: string;
  onSubFilterChange: (v: string) => void;
  user: SessionUser;
}) {
  const clockNow = useAppStore((s) => s.clock.now);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selected, setSelected] = useState<InvoiceDTO | null>(null);

  const paid = invoices.filter((i) => i.status === "PAID");
  const lifetimePaid = paid.reduce((sum, i) => sum + i.amountCents, 0);
  const year = new Date(clockNow).getFullYear();
  const thisYear = paid
    .filter((i) => new Date(i.createdAt).getFullYear() === year)
    .reduce((sum, i) => sum + i.amountCents, 0);
  const failedCount = invoices.filter((i) => i.status === "FAILED").length;

  const filterSub = subs.find((s) => s.id === subFilter);
  const filtered = invoices.filter((inv) => {
    if (statusFilter !== "ALL" && inv.status !== statusFilter) return false;
    if (filterSub && inv.product?.id !== filterSub.product.id) return false;
    return true;
  });

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={fadeUp}>
        <SectionHeader
          title="Invoices"
          description="Your complete billing history across every membership."
        />
      </motion.div>

      {/* Summary stats */}
      <motion.div variants={fadeUp} className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total paid lifetime" value={fmtMoney(lifetimePaid)} sub={`${paid.length} paid invoices`} icon={ReceiptText} />
        <StatCard label={`Paid in ${year}`} value={fmtMoney(thisYear)} icon={CalendarRange} />
        <StatCard label="Failed payments" value={String(failedCount)} sub={failedCount ? "retry from Memberships" : "all clear"} icon={TriangleAlert} />
      </motion.div>

      {/* Filters */}
      <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 rounded-xl" aria-label="Filter invoices by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="PAID">Paid</SelectItem>
            <SelectItem value="FAILED">Failed</SelectItem>
            <SelectItem value="REFUNDED">Refunded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={subFilter} onValueChange={onSubFilterChange}>
          <SelectTrigger className="h-9 min-w-44 rounded-xl" aria-label="Filter invoices by membership">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All memberships</SelectItem>
            {subs.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.product.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filterSub && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-xs text-muted-foreground"
            onClick={() => onSubFilterChange("all")}
          >
            Clear filter <CircleX className="h-3.5 w-3.5" aria-hidden />
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {filtered.length} invoice{filtered.length === 1 ? "" : "s"}
        </span>
      </motion.div>

      {/* Table */}
      <motion.div variants={fadeUp}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No invoices match"
            description="Try a different status or membership filter."
          />
        ) : (
          <Panel className="overflow-hidden">
            <div className="max-h-[34rem] overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:hover:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-transparent">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Invoice</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="hidden md:table-cell">Date</TableHead>
                    <TableHead className="hidden lg:table-cell">Period</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-10 pr-5" aria-label="Open invoice" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((inv) => (
                    <TableRow
                      key={inv.id}
                      className="cursor-pointer"
                      onClick={() => setSelected(inv)}
                      aria-label={`View invoice ${inv.number}`}
                    >
                      <TableCell className="py-3.5 pl-5 font-mono text-xs font-medium">{inv.number}</TableCell>
                      <TableCell className="max-w-56">
                        <p className="truncate text-sm font-medium">{inv.product?.title || "Vendly"}</p>
                        <p className="truncate text-xs text-muted-foreground">{inv.description}</p>
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums md:table-cell">
                        {fmtDate(inv.createdAt)}
                      </TableCell>
                      <TableCell className="hidden text-xs tabular-nums text-muted-foreground lg:table-cell">
                        {inv.periodStart ? `${fmtDate(inv.periodStart)} – ${fmtDate(inv.periodEnd)}` : "—"}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {inv.gateway ? <GatewayBadge gateway={inv.gateway} /> : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">
                        {fmtMoney(inv.amountCents, { cents: true })}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell className="pr-5">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>
        )}
      </motion.div>

      {/* ---- Invoice detail dialog ---- */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Invoice <span className="font-mono text-base">{selected?.number}</span>
              {selected && <StatusBadge status={selected.status} />}
            </DialogTitle>
            <DialogDescription>{selected?.description}</DialogDescription>
          </DialogHeader>
          {selected && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Product</dt>
                <dd className="mt-0.5 font-medium">{selected.product?.title || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Amount</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">
                  {fmtMoney(selected.amountCents, { cents: true })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Issued</dt>
                <dd className="mt-0.5 font-medium">{fmtDateTime(selected.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Paid</dt>
                <dd className="mt-0.5 font-medium">{selected.paidAt ? fmtDateTime(selected.paidAt) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Billing period</dt>
                <dd className="mt-0.5 font-medium tabular-nums">
                  {selected.periodStart
                    ? `${fmtDate(selected.periodStart)} – ${fmtDate(selected.periodEnd)}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Gateway</dt>
                <dd className="mt-0.5">{selected.gateway ? <GatewayBadge gateway={selected.gateway} /> : "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Billed to</dt>
                <dd className="mt-0.5 font-medium">{user.email}</dd>
              </div>
            </dl>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => {
                if (selected) downloadReceipt(selected, user.email);
              }}
            >
              <FileDown className="h-4 w-4" aria-hidden /> Download receipt
            </Button>
            <Button onClick={() => setSelected(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </motion.section>
  );
}

// ============================================================================
// Tab: Payment methods
// ============================================================================

function PaymentMethodsTab({
  methods,
  subs,
  reload,
}: {
  methods: PaymentMethodDTO[];
  subs: SubscriptionDTO[];
  reload: () => void;
}) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<"CARD" | "PAYPAL" | "CRYPTO">("CARD");
  const [cardNumber, setCardNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [wallet, setWallet] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [defaultBusyId, setDefaultBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PaymentMethodDTO | null>(null);

  function resetForm() {
    setCardNumber("");
    setExpMonth("");
    setExpYear("");
    setCvc("");
    setPaypalEmail("");
    setWallet("");
    setMakeDefault(false);
  }

  async function addMethod() {
    setBusy(true);
    try {
      let json: Record<string, unknown>;
      if (addType === "CARD") {
        const number = cardNumber.replace(/\s+/g, "");
        if (!/^\d{13,19}$/.test(number)) throw new Error("Enter a valid card number.");
        const m = Number(expMonth);
        const y = Number(expYear);
        if (!m || m < 1 || m > 12 || !y || y < 2000) throw new Error("Enter a valid expiry date.");
        json = { type: "CARD", card: { number, expMonth: m, expYear: y, cvc }, makeDefault };
      } else if (addType === "PAYPAL") {
        if (!paypalEmail.includes("@")) throw new Error("Enter the PayPal account email.");
        json = { type: "PAYPAL", paypalEmail: paypalEmail.trim(), makeDefault };
      } else {
        if (!/^0x[a-fA-F0-9]{6,}$/.test(wallet.trim())) throw new Error("Enter a valid EVM wallet address (0x…).");
        json = { type: "CRYPTO", walletAddress: wallet.trim(), makeDefault };
      }
      const res = await api<{ paymentMethod: PaymentMethodDTO }>("/api/payment-methods", { json });
      toast({
        title: `${pmShort(res.paymentMethod)} added`,
        description: makeDefault ? "Set as your default payment method." : undefined,
      });
      setAddOpen(false);
      resetForm();
      reload();
    } catch (e) {
      toast({
        title: "Couldn't add payment method",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function setDefault(pm: PaymentMethodDTO) {
    setDefaultBusyId(pm.id);
    try {
      await api(`/api/payment-methods/${pm.id}`, { method: "PATCH" });
      toast({ title: "Default updated", description: `${pmShort(pm)} is now your default method.` });
      reload();
    } catch (e) {
      toast({
        title: "Couldn't set default",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDefaultBusyId(null);
    }
  }

  async function remove(pm: PaymentMethodDTO) {
    setDefaultBusyId(pm.id);
    try {
      await api(`/api/payment-methods/${pm.id}`, { method: "DELETE" });
      toast({ title: "Payment method removed", description: `${pmShort(pm)} was deleted.` });
      setDeleteTarget(null);
      reload();
    } catch (e) {
      toast({
        title: "Couldn't remove method",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDefaultBusyId(null);
    }
  }

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={fadeUp}>
        <SectionHeader
          title="Payment methods"
          description="Cards, PayPal and crypto wallets used across your memberships."
          action={
            <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Add payment method
            </Button>
          }
        />
      </motion.div>

      <motion.div
        variants={fadeUp}
        className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        <p className="leading-relaxed text-amber-800 dark:text-amber-300">
          This is a simulated environment — no real charges occur. Gateways are sandboxed mocks of Stripe,
          PayPal and on-chain crypto transfers.
        </p>
      </motion.div>

      {methods.length === 0 ? (
        <motion.div variants={fadeUp}>
          <EmptyState
            icon={Wallet}
            title="No payment methods"
            description="Add a card, PayPal account or crypto wallet to pay for subscriptions."
            action={
              <Button className="rounded-xl" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" aria-hidden /> Add payment method
              </Button>
            }
          />
        </motion.div>
      ) : (
        <motion.div variants={fadeUp} className="grid gap-4 md:grid-cols-2">
          {methods.map((pm) => {
            const usedBy = subs.filter(
              (s) => ACTIVE_STATUSES.includes(s.status) && s.paymentMethod?.id === pm.id
            );
            return (
              <Panel
                key={pm.id}
                className={cn(
                  "group p-5 transition-all",
                  !pm.isDefault && "cursor-pointer hover:shadow-md hover:ring-1 hover:ring-primary/30",
                  pm.isDefault && "ring-1 ring-primary/40"
                )}
                onClick={() => !pm.isDefault && setDefault(pm)}
                role={pm.isDefault ? undefined : "button"}
                aria-label={pm.isDefault ? undefined : `Set ${pmShort(pm)} as default payment method`}
              >
                <div className="flex items-start gap-4">
                  {/* Type visual */}
                  {pm.type === "CARD" && (
                    <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-950 text-[9px] font-black tracking-widest text-white shadow-inner">
                      {(pm.brand || "CARD").toUpperCase().slice(0, 4)}
                    </div>
                  )}
                  {pm.type === "PAYPAL" && (
                    <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <span className="text-lg font-black italic text-muted-foreground">P</span>
                    </div>
                  )}
                  {pm.type === "CRYPTO" && (
                    <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Bitcoin className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{pmShort(pm)}</p>
                      {pm.isDefault && (
                        <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pm.type === "CARD" && `Expires ${String(pm.expMonth).padStart(2, "0")}/${pm.expYear}`}
                      {pm.type === "PAYPAL" && "PayPal account"}
                      {pm.type === "CRYPTO" && (
                        <span className="inline-flex items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {pm.chain || "ETH"}
                          </Badge>
                          <span className="break-all font-mono">{pm.walletAddress}</span>
                        </span>
                      )}
                    </p>
                    {usedBy.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Used by {usedBy.map((s) => s.product.title).join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {!pm.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-lg"
                        disabled={defaultBusyId === pm.id}
                        onClick={() => setDefault(pm)}
                      >
                        {defaultBusyId === pm.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : null}
                        Set default
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(pm)}
                      aria-label={`Delete ${pmShort(pm)}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </Panel>
            );
          })}
        </motion.div>
      )}

      {/* ---- Add method dialog ---- */}
      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add payment method</DialogTitle>
            <DialogDescription>Saved to your account and available for future renewals.</DialogDescription>
          </DialogHeader>
          <Tabs value={addType} onValueChange={(v) => setAddType(v as typeof addType)}>
            <TabsList className="grid w-full grid-cols-3 rounded-xl">
              <TabsTrigger value="CARD">Card</TabsTrigger>
              <TabsTrigger value="PAYPAL">PayPal</TabsTrigger>
              <TabsTrigger value="CRYPTO">Crypto</TabsTrigger>
            </TabsList>
            <TabsContent value="CARD" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="card-number">Card number</Label>
                <Input
                  id="card-number"
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="4242 4242 4242 4242"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                  className="rounded-xl tabular-nums"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="card-month">Month</Label>
                  <Input
                    id="card-month"
                    inputMode="numeric"
                    placeholder="12"
                    value={expMonth}
                    onChange={(e) => setExpMonth(e.target.value)}
                    className="rounded-xl tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="card-year">Year</Label>
                  <Input
                    id="card-year"
                    inputMode="numeric"
                    placeholder="2028"
                    value={expYear}
                    onChange={(e) => setExpYear(e.target.value)}
                    className="rounded-xl tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="card-cvc">CVC</Label>
                  <Input
                    id="card-cvc"
                    inputMode="numeric"
                    placeholder="123"
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value)}
                    className="rounded-xl tabular-nums"
                  />
                </div>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Test hint: 4242 4242 4242 4242 succeeds — cards ending 0002 or 9995 always decline.
              </p>
            </TabsContent>
            <TabsContent value="PAYPAL" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="paypal-email">PayPal account email</Label>
                <Input
                  id="paypal-email"
                  type="email"
                  placeholder="you@example.com"
                  value={paypalEmail}
                  onChange={(e) => setPaypalEmail(e.target.value)}
                  className="rounded-xl"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Billing agreements are simulated — no PayPal login required.
              </p>
            </TabsContent>
            <TabsContent value="CRYPTO" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wallet-address">Wallet address</Label>
                <Input
                  id="wallet-address"
                  placeholder="0x7aF3b21c9E4d5A60…"
                  value={wallet}
                  onChange={(e) => setWallet(e.target.value)}
                  className="rounded-xl font-mono text-sm"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                EVM address (Ethereum, Polygon, Base…). Subscriptions renew via simulated on-chain transfers.
              </p>
            </TabsContent>
          </Tabs>
          <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Set as default</p>
              <p className="text-xs text-muted-foreground">Preferred for new subscriptions</p>
            </div>
            <Switch checked={makeDefault} onCheckedChange={setMakeDefault} aria-label="Set as default" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={addMethod} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Add method
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Delete confirm ---- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this payment method?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `${pmShort(deleteTarget)} will be removed from your account. Methods attached to an active membership can't be deleted — switch that membership to another method first.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep method</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={defaultBusyId === deleteTarget?.id}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) void remove(deleteTarget);
              }}
            >
              {defaultBusyId === deleteTarget?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.section>
  );
}

// ============================================================================
// Tab: Settings
// ============================================================================

function SettingsTab({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const setUser = useAppStore((s) => s.setUser);
  const [name, setName] = useState(user.name ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [discord, setDiscord] = useState(user.discordHandle ?? "");
  const [telegram, setTelegram] = useState(user.telegramHandle ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingAccounts, setSavingAccounts] = useState(false);

  // Re-sync local form state when the demo account switches.
  useEffect(() => {
    setName(user.name ?? "");
    setBio(user.bio ?? "");
    setDiscord(user.discordHandle ?? "");
    setTelegram(user.telegramHandle ?? "");
  }, [user.id, user.name, user.bio, user.discordHandle, user.telegramHandle]);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const res = await api<SessionUser>("/api/me", {
        method: "PATCH",
        json: { name: name.trim(), bio },
      });
      setUser(res);
      toast({ title: "Profile saved", description: "Your public profile has been updated." });
    } catch (e) {
      toast({
        title: "Couldn't save profile",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveAccounts() {
    setSavingAccounts(true);
    try {
      const res = await api<SessionUser>("/api/me", {
        method: "PATCH",
        json: { discordHandle: discord.trim(), telegramHandle: telegram.trim() },
      });
      setUser(res);
      toast({
        title: "Connected accounts saved",
        description: "Creator bots will use these handles to assign your roles at checkout.",
      });
    } catch (e) {
      toast({
        title: "Couldn't save accounts",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingAccounts(false);
    }
  }

  return (
    <motion.section variants={stagger} initial="hidden" animate="show" className="space-y-5">
      <motion.div variants={fadeUp}>
        <SectionHeader title="Settings" description="Profile, connected accounts and account details." />
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Profile */}
        <motion.div variants={fadeUp}>
          <Panel className="h-full p-5 sm:p-6">
            <h2 className="font-bold tracking-tight">Profile</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              How you appear on reviews and community member lists.
            </p>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="profile-name">Display name</Label>
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="rounded-xl"
                  maxLength={80}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="profile-bio">Bio</Label>
                <Textarea
                  id="profile-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="A short introduction…"
                  className="min-h-24 rounded-xl"
                  maxLength={400}
                />
                <p className="text-right text-[11px] text-muted-foreground tabular-nums">{bio.length}/400</p>
              </div>
              <Button className="rounded-xl" onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CircleCheck className="h-4 w-4" aria-hidden />
                )}
                Save profile
              </Button>
            </div>
          </Panel>
        </motion.div>

        {/* Connected accounts */}
        <motion.div variants={fadeUp}>
          <Panel className="h-full p-5 sm:p-6">
            <h2 className="font-bold tracking-tight">Connected accounts</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Used by creator bots to assign your roles automatically at checkout — keep these in sync with
              your actual accounts.
            </p>
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="discord-handle">Discord handle</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    @
                  </span>
                  <Input
                    id="discord-handle"
                    value={discord}
                    onChange={(e) => setDiscord(e.target.value)}
                    placeholder="alexrivera"
                    className="rounded-xl pl-7"
                    maxLength={40}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="telegram-handle">Telegram handle</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    @
                  </span>
                  <Input
                    id="telegram-handle"
                    value={telegram}
                    onChange={(e) => setTelegram(e.target.value)}
                    placeholder="alexrivera"
                    className="rounded-xl pl-7"
                    maxLength={40}
                  />
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                <AtSign className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Roles sync instantly via webhook events like <code className="font-mono">access.granted</code>{" "}
                when you join a community.
              </div>
              <Button className="rounded-xl" onClick={saveAccounts} disabled={savingAccounts}>
                {savingAccounts ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <CircleCheck className="h-4 w-4" aria-hidden />
                )}
                Save accounts
              </Button>
            </div>
          </Panel>
        </motion.div>
      </div>

      {/* Account info */}
      <motion.div variants={fadeUp}>
        <Panel className="p-5 sm:p-6">
          <h2 className="font-bold tracking-tight">Account</h2>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <UserAvatar name={user.name} color={user.avatarColor} size="lg" />
            <div className="min-w-0">
              <p className="font-semibold">{user.name || "Unnamed member"}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {user.role === "CREATOR" ? "Creator" : "Customer"}
                </Badge>
                <span className="text-xs text-muted-foreground">Member since {fmtDate(user.createdAt)}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 max-w-sm space-y-1.5">
            <Label htmlFor="account-email">Email (read-only)</Label>
            <Input id="account-email" value={user.email} disabled readOnly className="rounded-xl" />
            <p className="text-[11px] text-muted-foreground">
              Demo accounts sign in with email only — no password in this environment.
            </p>
          </div>
        </Panel>
      </motion.div>
    </motion.section>
  );
}
