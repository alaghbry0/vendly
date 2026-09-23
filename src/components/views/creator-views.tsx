"use client";

// CREATOR ANALYTICS DASHBOARD — "Creator Studio".
// Owned by Task 2-c. Rendered when store.view === "creator".
// Internal tab system (synced from params.creatorTab): overview | products |
// subscribers | orders | promos | affiliates | giveaways | questions | webhooks |
// payouts | time (billing time machine). Promos + payouts tabs added by
// Task 5-c; the affiliates tab + the product edit dialog with plans editor
// by Task 8-b; the giveaways tab by Task 11-b; the Q&A inbox by Task 12-c.

import { useEffect, useMemo, useRef, useState, type ComponentProps, type FormEvent } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useAppStore } from "@/lib/store";
import { api } from "@/lib/api";
import { WorkerPanel } from "@/components/views/worker-panel";
import type {
  AffiliateProgramDTO,
  AnalyticsDTO,
  AnswerDTO,
  BillingRunResult,
  CreatorQuestionDTO,
  GiveawayCreatorDTO,
  PayoutBalanceDTO,
  PayoutDTO,
  PlanDTO,
  ProductCardDTO,
  ProductDetailDTO,
  PromoCodeDTO,
  QuestionsStatsDTO,
  SessionUser,
  WebhookDeliveryDTO,
  WebhookEndpointDTO,
} from "@/lib/types";
import { CATEGORIES, COVER_THEMES, WEBHOOK_EVENTS } from "@/lib/types";
import { COVER_THEMES as COVER_GRADIENTS, fmtCompact, fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import {
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  Ban,
  Banknote,
  BadgeCheck,
  BadgePercent,
  Bitcoin,
  CalendarClock,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  CircleHelp,
  Clock,
  CreditCard,
  Dices,
  DollarSign,
  Eye,
  EyeOff,
  FastForward,
  FlaskConical,
  Gift,
  Handshake,
  Inbox,
  Info,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  Loader2,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  MousePointerClick,
  Package,
  PackagePlus,
  PenLine,
  Pencil,
  Pause,
  Percent,
  Play,
  Plus,
  Receipt,
  ReceiptText,
  RefreshCw,
  Repeat,
  Rocket,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Tag,
  Terminal,
  Timer,
  Trash2,
  TrendingUp,
  Trophy,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
  Webhook,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ============================================================================
// Tabs, constants & helpers
// ============================================================================

type CreatorTab =
  | "overview"
  | "products"
  | "subscribers"
  | "orders"
  | "promos"
  | "affiliates"
  | "giveaways"
  | "questions"
  | "webhooks"
  | "payouts"
  | "time";

const CREATOR_TABS: { key: CreatorTab; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "products", label: "Products", icon: Package },
  { key: "subscribers", label: "Subscribers", icon: Users },
  { key: "orders", label: "Orders", icon: ReceiptText },
  { key: "promos", label: "Promos", icon: Tag },
  { key: "affiliates", label: "Affiliates", icon: Megaphone },
  { key: "giveaways", label: "Giveaways", icon: Gift },
  { key: "questions", label: "Q&A", icon: MessagesSquare },
  { key: "webhooks", label: "Webhooks", icon: Webhook },
  { key: "payouts", label: "Payouts", icon: Banknote },
  { key: "time", label: "Time machine", icon: Timer },
];

const TAB_KEYS = CREATOR_TABS.map((t) => t.key);

function isCreatorTab(v: unknown): v is CreatorTab {
  return typeof v === "string" && (TAB_KEYS as string[]).includes(v);
}

const stagger: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: "easeOut" } },
};

/** Chart palette — emerald-first, no blue/indigo primaries. */
const CHART = {
  emerald: "#10b981",
  teal: "#14b8a6",
  rose: "#f43f5e",
  amber: "#f59e0b",
  violet: "#8b5cf6",
};

/** Gateway colors for the revenue-mix donut. */
const GATEWAY_CHART_COLORS: Record<string, string> = {
  WHOP: CHART.teal,
  STRIPE: CHART.violet,
  PAYPAL: CHART.amber,
  CRYPTO: CHART.emerald,
};
const GATEWAY_LABELS: Record<string, string> = {
  WHOP: "Card · Whop",
  STRIPE: "Card · Stripe",
  PAYPAL: "PayPal",
  CRYPTO: "Crypto",
};

/** Sim-clock aware relative time (the browser clock may lag simulated time). */
function relTime(iso: string, nowIso: string): string {
  const diff = new Date(nowIso).getTime() - new Date(iso).getTime();
  if (diff < 0) {
    const d = -diff;
    const days = Math.floor(d / 86400000);
    if (days >= 1) return `in ${days}d`;
    const hours = Math.floor(d / 3600000);
    if (hours >= 1) return `in ${hours}h`;
    return `in ${Math.max(1, Math.floor(d / 60000))}m`;
  }
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

/** "2026-09-17" → "Sep 17" for chart axes. */
function fmtAxisDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Chart series store dollars — format without the cents-to-dollars helper. */
function fmtDollars(v: number): string {
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function shortWallet(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : addr;
}

interface SubPaymentMethod {
  type: string;
  brand: string | null;
  last4: string | null;
  email: string | null;
  walletAddress: string | null;
}

function pmLine(pm: SubPaymentMethod | null): string {
  if (!pm) return "No saved method";
  if (pm.type === "CARD") return `${pm.brand || "Card"} ••••${pm.last4 || "····"}`;
  if (pm.type === "PAYPAL") return pm.email || "PayPal account";
  return shortWallet(pm.walletAddress || "");
}

/** Card-style panel used across the studio (full control over padding). */
function Panel({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("rounded-2xl border bg-card shadow-sm", className)} {...props}>
      {children}
    </div>
  );
}

/** Thin custom scrollbar styling for scroll containers. */
const SCROLL_THIN =
  "[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`Rated ${rating.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn("h-3 w-3", i <= Math.round(rating) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")}
        />
      ))}
    </span>
  );
}

function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label || key;
}

function LoadError({ message }: { message: string }) {
  const refresh = useAppStore((s) => s.refresh);
  return (
    <EmptyState
      icon={TriangleAlert}
      title="Couldn't load this section"
      description={message}
      action={
        <Button variant="outline" onClick={() => refresh()}>
          <RotateCcw className="h-4 w-4" /> Try again
        </Button>
      }
    />
  );
}

// ============================================================================
// Data loading
// ============================================================================

/**
 * Fetches on mount, on store refresh (nonce) and on demo-account switch.
 * Existing data is kept while refetching so the UI never flashes skeletons.
 */
function useCreatorFetch<T>(load: () => Promise<T>) {
  const nonce = useAppStore((s) => s.nonce);
  const userId = useAppStore((s) => s.user?.id);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    loadRef
      .current()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Something went wrong.");
      });
    return () => {
      alive = false;
    };
  }, [nonce, userId]);

  return { data, error, loading: data === null && error === null, setData };
}

function useSimNow(): string {
  return useAppStore((s) => s.clock.now);
}

// ============================================================================
// Chart tooltips (shared shell + per-chart bodies)
// ============================================================================

interface TipItem {
  name?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}
interface TipProps {
  active?: boolean;
  payload?: TipItem[];
  label?: string | number;
}

function TipShell({ label, rows }: { label: string; rows: { color?: string; label: string; value: string }[] }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2 shadow-lg">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            {r.color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} /> : null}
            <span className="text-muted-foreground">{r.label}</span>
            <span className="ml-auto pl-4 font-semibold tabular-nums text-foreground">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MrrTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <TipShell
      label={fmtAxisDate(String(label ?? ""))}
      rows={[{ color: CHART.emerald, label: "MRR", value: fmtDollars(Number(payload[0].value ?? 0)) }]}
    />
  );
}

function RevenueTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const count = Number((payload[0].payload as { count?: number } | undefined)?.count ?? 0);
  return (
    <TipShell
      label={fmtAxisDate(String(label ?? ""))}
      rows={[
        { color: CHART.amber, label: "Revenue", value: fmtDollars(Number(payload[0].value ?? 0)) },
        { label: "Invoices", value: String(count) },
      ]}
    />
  );
}

function SubsTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const colors: Record<string, string> = { active: CHART.emerald, new: CHART.teal, canceled: CHART.rose };
  const names: Record<string, string> = { active: "Active", new: "New", canceled: "Canceled" };
  return (
    <TipShell
      label={fmtAxisDate(String(label ?? ""))}
      rows={payload.map((p) => ({
        color: colors[String(p.name)] || CHART.emerald,
        label: names[String(p.name)] || String(p.name),
        value: String(p.value ?? 0),
      }))}
    />
  );
}

function GatewayTip({ active, payload }: TipProps) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const entry = (item.payload ?? {}) as { count?: number };
  const gw = String(item.name ?? "");
  return (
    <TipShell
      label={GATEWAY_LABELS[gw] || gw}
      rows={[
        { color: GATEWAY_CHART_COLORS[gw], label: "Revenue", value: fmtMoney(Number(item.value ?? 0)) },
        { label: "Subscriptions", value: String(entry.count ?? 0) },
      ]}
    />
  );
}

const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

// ============================================================================
// Root component
// ============================================================================

export function CreatorViews() {
  const user = useAppStore((s) => s.user);
  const params = useAppStore((s) => s.params);
  const clock = useAppStore((s) => s.clock);
  const navigate = useAppStore((s) => s.navigate);

  // Tab state is store-driven (params.creatorTab) so deep links — e.g. the
  // header's "Simulated +Nd" chip — always land on the right tab.
  const tab: CreatorTab = isCreatorTab(params.creatorTab) ? params.creatorTab : "overview";

  function goToTab(t: CreatorTab) {
    navigate("creator", { creatorTab: t });
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-7xl px-4 py-16">
        <EmptyState
          icon={LayoutDashboard}
          title="Sign in to open your Creator Studio"
          description="Pick a demo account from the header menu — try Marcus Chen or Aisha Rahman for a fully populated studio."
        />
      </div>
    );
  }

  return (
    <motion.div
      className="container mx-auto max-w-7xl px-4 py-8 sm:py-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* grid-cols-1 = minmax(0,1fr) so the 8-pill mobile tab row scrolls inside
          its overflow-x-auto wrapper instead of blowing out the page width. */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[15rem_1fr]">
        {/* ---------- Sidebar (desktop) ---------- */}
        <aside className="hidden lg:block">
          <nav className="sticky top-20 w-60" aria-label="Creator Studio sections">
            <div className="mb-4 flex items-center gap-3 rounded-2xl border bg-card p-3 shadow-sm">
              <UserAvatar name={user.name} color={user.avatarColor} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.name || "Creator"}</p>
                <p className="truncate text-[11px] text-muted-foreground">Creator Studio · {user.email}</p>
              </div>
            </div>
            <ul className="flex flex-col gap-1">
              {CREATOR_TABS.map((t) => {
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
                      {t.key === "time" && clock.simulated && (
                        <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-amber-500" aria-label="Simulated clock active" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            <button
              onClick={() => goToTab("time")}
              className="mt-6 flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors hover:bg-muted/50"
              aria-label="Open the billing time machine"
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                  clock.simulated
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
                )}
              >
                <Timer className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold">{clock.simulated ? clock.label : "Live clock"}</span>
                <span className="block truncate text-[11px] tabular-nums text-muted-foreground">{fmtDateTime(clock.now)}</span>
              </span>
            </button>
          </nav>
        </aside>

        {/* ---------- Mobile pill nav ---------- */}
        <div className="lg:hidden">
          <div
            className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="Creator Studio sections"
          >
            <div className="flex gap-2">
              {CREATOR_TABS.map((t) => {
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
                    {t.key === "time" && clock.simulated && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />}
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
              {tab === "overview" && <OverviewTab user={user} />}
              {tab === "products" && <ProductsTab user={user} />}
              {tab === "subscribers" && <SubscribersTab />}
              {tab === "orders" && <OrdersTab />}
              {tab === "promos" && <PromosTab user={user} />}
              {tab === "affiliates" && <AffiliatesTab user={user} />}
              {tab === "giveaways" && <GiveawaysTab user={user} />}
              {tab === "questions" && <QuestionsTab user={user} />}
              {tab === "webhooks" && <WebhooksTab />}
              {tab === "payouts" && <PayoutsTab />}
              {tab === "time" && <TimeTab />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// Skeletons
// ============================================================================

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading analytics">
      <div className="flex items-center gap-3.5">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-80 rounded-2xl" />
        <Skeleton className="h-80 rounded-2xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-56 rounded-2xl lg:col-span-3" />
        <Skeleton className="h-56 rounded-2xl lg:col-span-2" />
      </div>
    </div>
  );
}

function CardsSkeleton({ count = 3, height = "h-72" }: { count?: number; height?: string }) {
  return (
    <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3" aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("rounded-2xl", height)} />
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <Panel className="overflow-hidden" aria-busy="true" aria-label={`${label} data`}>
      <div className="space-y-0">
        <Skeleton className="m-3 h-10 rounded-xl" />
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="mx-3 mb-2 h-12 rounded-xl" />
        ))}
      </div>
    </Panel>
  );
}

// ============================================================================
// TAB: OVERVIEW — the money dashboard
// ============================================================================

function OverviewTab({ user }: { user: SessionUser }) {
  const { data: analytics, error, loading } = useCreatorFetch(() =>
    api<{ analytics: AnalyticsDTO }>("/api/analytics").then((r) => r.analytics)
  );
  const [createOpen, setCreateOpen] = useState(false);

  if (loading) return <OverviewSkeleton />;
  if (error || !analytics) return <LoadError message={error || "Analytics unavailable."} />;

  // Onboarding: no products yet (works for customer demo accounts too).
  if (analytics.topProducts.length === 0) {
    return (
      <div className="py-8">
        <EmptyState
          icon={PackagePlus}
          title="You don't have any products yet"
          description="Create your first product to start selling memberships, licenses and communities — analytics, subscribers and orders will light up as you grow."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create your first product
            </Button>
          }
        />
        <p className="mx-auto mt-5 max-w-md text-center text-xs text-muted-foreground">
          Exploring with a customer account? Switch to a creator demo account —{" "}
          <span className="font-medium text-foreground">Marcus Chen</span> or{" "}
          <span className="font-medium text-foreground">Aisha Rahman</span> — from the header menu.
        </p>
        <CreateProductDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    );
  }

  const firstName = (user.name || "creator").split(" ")[0];
  const totalMrr = analytics.topProducts.reduce((s, p) => s + p.mrrCents, 0);
  const topProducts = analytics.topProducts.slice(0, 5);
  const gatewayTotal = analytics.gatewayBreakdown.reduce((s, g) => s + g.revenueCents, 0);
  const churnPct = analytics.churnRate * 100;
  const churnHigh = analytics.churnRate > 0.1;
  // Daily revenue is sparse (most days have zero charges) — bucket into
  // ~13 weekly sums so the bars are actually readable. (Cheap 90-item loop,
  // intentionally not memoized to keep hook order stable across early returns.)
  const weeklyRevenue: { date: string; revenue: number; count: number }[] = [];
  for (let i = 0; i < analytics.revenueSeries.length; i += 7) {
    const chunk = analytics.revenueSeries.slice(i, i + 7);
    if (chunk.length === 0) continue;
    weeklyRevenue.push({
      date: chunk[0].date,
      revenue: Math.round(chunk.reduce((s, d) => s + d.revenue, 0)),
      count: chunk.reduce((s, d) => s + d.count, 0),
    });
  }

  const gatewayData = analytics.gatewayBreakdown.map((g) => ({
    ...g,
    fill: GATEWAY_CHART_COLORS[g.gateway] || "#71717a",
  }));

  return (
    <div className="space-y-6">
      {/* ---------- Header ---------- */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <UserAvatar name={user.name} color={user.avatarColor} size="lg" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Creator Studio</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Welcome back, {firstName} — here's how your business is doing.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="gap-1.5 bg-muted/50 py-1.5 pl-2.5 pr-3 text-xs font-medium">
          <CalendarRange className="h-3.5 w-3.5 text-primary" /> Last 90 days
        </Badge>
      </header>

      {/* ---------- KPI cards ---------- */}
      <motion.div
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={fadeUp}>
          <StatCard
            label="Monthly recurring revenue"
            value={fmtMoney(analytics.mrrCents)}
            sub={`ARR ${fmtMoney(analytics.arrCents)}`}
            icon={TrendingUp}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            label="Active subscriptions"
            value={String(analytics.activeSubscriptions)}
            sub={`+${analytics.trialingCount} trialing · ${analytics.pastDueCount} past due`}
            icon={Users}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            label="Churn rate"
            value={`${churnPct.toFixed(1)}%`}
            sub={`${analytics.canceled30d} canceled in 30d`}
            icon={UserMinus}
            className={cn(churnHigh && "border-red-500/40 bg-red-500/[0.04]")}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <StatCard
            label="Revenue (30d)"
            value={fmtMoney(analytics.revenue30dCents)}
            sub={`Lifetime ${fmtMoney(analytics.totalRevenueCents)}`}
            icon={DollarSign}
          />
        </motion.div>
      </motion.div>

      {/* ---------- Charts ---------- */}
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-2">
        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <Panel className="p-5">
            <div className="mb-4">
              <h2 className="text-sm font-bold">MRR trend</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Monthly recurring revenue, daily snapshot</p>
            </div>
            <ResponsiveContainer width="100%" height={256}>
              <AreaChart data={analytics.mrrSeries} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="mrrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART.emerald} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={CHART.emerald} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} strokeOpacity={0.6} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => fmtAxisDate(v)}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tickMargin={8}
                />
                <YAxis
                  tickFormatter={(v: number) => `$${fmtCompact(v)}`}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip content={<MrrTip />} cursor={{ stroke: "var(--border)", strokeDasharray: "3 3" }} />
                <Area
                  type="monotone"
                  dataKey="mrr"
                  name="MRR"
                  stroke={CHART.emerald}
                  strokeWidth={2}
                  fill="url(#mrrGrad)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </Panel>
        </motion.div>

        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <Panel className="p-5">
            <div className="mb-4">
              <h2 className="text-sm font-bold">Weekly revenue</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Successful charges per week</p>
            </div>
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={weeklyRevenue} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} strokeOpacity={0.6} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => fmtAxisDate(v)}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tickMargin={8}
                />
                <YAxis
                  tickFormatter={(v: number) => `$${fmtCompact(v)}`}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <Tooltip content={<RevenueTip />} cursor={{ fill: "var(--muted)", fillOpacity: 0.4 }} />
                <Bar dataKey="revenue" name="Revenue" fill={CHART.amber} radius={[3, 3, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </motion.div>

        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <Panel className="p-5">
            <div className="mb-4">
              <h2 className="text-sm font-bold">Subscriber growth</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Active members with new and canceled per day</p>
            </div>
            <ResponsiveContainer width="100%" height={256}>
              <ComposedChart data={analytics.subscriberSeries} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} strokeOpacity={0.6} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v: string) => fmtAxisDate(v)}
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={48}
                  tickMargin={8}
                />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                <Tooltip content={<SubsTip />} cursor={{ fill: "var(--muted)", fillOpacity: 0.3 }} />
                <Legend
                  verticalAlign="bottom"
                  height={26}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, paddingTop: 6 }}
                />
                <Bar dataKey="new" name="New" fill={CHART.teal} barSize={4} radius={[2, 2, 0, 0]} />
                <Bar dataKey="canceled" name="Canceled" fill={CHART.rose} barSize={4} radius={[2, 2, 0, 0]} />
                <Line
                  dataKey="active"
                  name="Active"
                  stroke={CHART.emerald}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </Panel>
        </motion.div>

        <motion.div variants={fadeUp} initial="hidden" animate="show">
          <Panel className="p-5">
            <div className="mb-4">
              <h2 className="text-sm font-bold">Revenue by gateway</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Lifetime volume across payment processors</p>
            </div>
            {gatewayData.length === 0 || gatewayTotal === 0 ? (
              <div className="flex h-64 items-center justify-center">
                <EmptyState
                  icon={Wallet}
                  title="No revenue yet"
                  description="Gateway mix appears after your first successful charge."
                  className="border-0 p-6"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="relative h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={gatewayData}
                        dataKey="revenueCents"
                        nameKey="gateway"
                        innerRadius="62%"
                        outerRadius="88%"
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {gatewayData.map((g) => (
                          <Cell key={g.gateway} fill={g.fill} />
                        ))}
                      </Pie>
                      <Tooltip content={<GatewayTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <p className="text-lg font-bold tabular-nums tracking-tight">{fmtMoney(gatewayTotal)}</p>
                    <p className="text-[11px] text-muted-foreground">total revenue</p>
                  </div>
                </div>
                <ul className="mt-3 w-full space-y-2">
                  {gatewayData.map((g) => {
                    const share = gatewayTotal > 0 ? g.revenueCents / gatewayTotal : 0;
                    return (
                      <li key={g.gateway} className="flex items-center gap-2.5 text-xs">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.fill }} />
                        <span className="min-w-0 flex-1 truncate font-medium">{GATEWAY_LABELS[g.gateway] || g.gateway}</span>
                        <span className="tabular-nums text-muted-foreground">{g.count} subs</span>
                        <span className="w-20 text-right font-semibold tabular-nums">{fmtMoney(g.revenueCents)}</span>
                        <span className="w-9 text-right tabular-nums text-muted-foreground">{Math.round(share * 100)}%</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Panel>
        </motion.div>
      </div>

      {/* ---------- Top products + activity ---------- */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
        <Panel className="overflow-hidden lg:col-span-3">
          <div className="border-b p-5 pb-4">
            <h2 className="text-sm font-bold">Top products</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Ranked by monthly recurring revenue</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-5 py-2.5 font-medium">Product</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Members</th>
                <th scope="col" className="px-3 py-2.5 font-medium">MRR</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">Lifetime</th>
              </tr>
            </thead>
            <tbody>
              {topProducts.map((p) => {
                const share = totalMrr > 0 ? Math.round((p.mrrCents / totalMrr) * 100) : 0;
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <ProductCover
                          theme={p.coverTheme}
                          category="OTHER"
                          title={p.title}
                          className="h-10 w-14 shrink-0 rounded-lg"
                          iconClassName="h-12 w-12"
                        />
                        <span className="min-w-0 truncate font-medium">{p.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{fmtCompact(p.members)}</td>
                    <td className="w-44 px-3 py-3">
                      <p className="font-semibold tabular-nums">{fmtMoney(p.mrrCents)}</p>
                      <Progress value={share} className="mt-1.5 h-1.5 w-28" aria-label={`${share}% of MRR`} />
                    </td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{fmtMoney(p.revenueCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <RecentActivity activity={analytics.recentActivity} />
      </div>
    </div>
  );
}

function RecentActivity({ activity }: { activity: AnalyticsDTO["recentActivity"] }) {
  const now = useSimNow();
  return (
    <Panel className="flex flex-col overflow-hidden lg:col-span-2">
      <div className="border-b p-5 pb-4">
        <h2 className="text-sm font-bold">Recent activity</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Latest payments and subscriptions</p>
      </div>
      {activity.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Payments and new subscriptions will appear here."
          className="m-4 flex-1 border-0"
        />
      ) : (
        <ul className={cn("max-h-80 divide-y overflow-y-auto", SCROLL_THIN)} aria-label="Recent activity">
          {activity.map((a) => {
            const meta = activityIcon(a.type);
            const Icon = meta.icon;
            return (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", meta.cls)}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug">{a.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{relTime(a.at, now)}</p>
                </div>
                {a.amountCents != null && (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {fmtMoney(a.amountCents)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function activityIcon(type: string): { icon: LucideIcon; cls: string } {
  if (type === "invoice.paid") return { icon: DollarSign, cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" };
  if (type === "invoice.failed" || type === "invoice") return { icon: XCircle, cls: "bg-red-500/12 text-red-600 dark:text-red-400" };
  if (type === "subscription.created") return { icon: UserPlus, cls: "bg-teal-500/12 text-teal-600 dark:text-teal-400" };
  return { icon: Activity, cls: "bg-muted text-muted-foreground" };
}

// ============================================================================
// TAB: PRODUCTS
// ============================================================================

interface TierDraft {
  name: string;
  price: string;
  interval: "month" | "year";
  trialDays: string;
  badge: string;
}

const EMPTY_TIER: TierDraft = { name: "", price: "", interval: "month", trialDays: "", badge: "" };

const ACCESS_OPTIONS: { key: string; label: string }[] = [
  { key: "DISCORD", label: "Discord role" },
  { key: "TELEGRAM", label: "Telegram channel" },
  { key: "LICENSE", label: "License key" },
  { key: "FILE", label: "File vault" },
];

function ProductsTab({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const refresh = useAppStore((s) => s.refresh);
  const navigate = useAppStore((s) => s.navigate);

  // The catalog endpoint only lists ACTIVE products — remember paused ones so
  // creators never lose sight of their own listings between refetches.
  const cacheRef = useRef<{ userId: string; map: Map<string, ProductCardDTO> }>({ userId: "", map: new Map() });

  const { data, error, loading, setData } = useCreatorFetch(async () => {
    const [productsRes, analyticsRes] = await Promise.all([
      api<{ products: ProductCardDTO[] }>(`/api/products?creatorId=${user.id}`),
      api<{ analytics: AnalyticsDTO }>("/api/analytics"),
    ]);
    const cache = cacheRef.current;
    if (cache.userId !== user.id) {
      cache.userId = user.id;
      cache.map.clear();
    }
    const fresh = productsRes.products;
    const known = [...cache.map.values()].filter((p) => !fresh.some((f) => f.id === p.id));
    const merged = [...fresh, ...known];
    for (const p of merged) cache.map.set(p.id, p);
    return { products: merged, analytics: analyticsRes.analytics };
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProductCardDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function replaceProduct(updated: ProductDetailDTO | ProductCardDTO) {
    cacheRef.current.map.set(updated.id, updated as ProductCardDTO);
    setData((prev) =>
      prev
        ? {
            ...prev,
            products: prev.products.some((p) => p.id === updated.id)
              ? prev.products.map((p) => (p.id === updated.id ? (updated as ProductCardDTO) : p))
              : [...prev.products, updated as ProductCardDTO],
          }
        : prev
    );
  }

  async function toggleStatus(p: ProductCardDTO) {
    const next = p.status === "PAUSED" ? "ACTIVE" : "PAUSED";
    setBusyId(p.id);
    try {
      const res = await api<{ product: ProductDetailDTO }>(`/api/products/${p.id}`, {
        method: "PATCH",
        json: { status: next },
      });
      if (res.product) replaceProduct(res.product);
      toast({
        title: next === "PAUSED" ? "Product paused" : "Product resumed",
        description:
          next === "PAUSED"
            ? `${p.title} is now hidden from the marketplace. Existing members keep access.`
            : `${p.title} is live on the marketplace again.`,
      });
    } catch (e) {
      toast({ title: "Couldn't update the product", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <CardsSkeleton count={3} />;
  if (error || !data) return <LoadError message={error || "Products unavailable."} />;

  const { products, analytics } = data;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Products"
        description={`${products.length} listing${products.length === 1 ? "" : "s"} on the Vendly marketplace`}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New product
          </Button>
        }
      />

      {products.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title="You don't have any products yet"
          description="Create your first product — memberships, licenses, communities and digital files all live here."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create your first product
            </Button>
          }
        />
      ) : (
        <motion.div
          className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {products.map((p) => {
            const mrr = analytics.topProducts.find((t) => t.id === p.id)?.mrrCents ?? null;
            const paused = p.status === "PAUSED";
            const plans = [...p.plans].sort((a, b) => a.sortOrder - b.sortOrder);
            return (
              <motion.div key={p.id} variants={fadeUp}>
                <Panel className={cn("flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md", paused && "opacity-80")}>
                  <div className="relative">
                    <ProductCover
                      theme={p.coverTheme}
                      category={p.category}
                      title={p.title}
                      className={cn("h-28", paused && "grayscale-[45%]")}
                      iconClassName="h-24 w-24"
                    />
                    <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                      <StatusBadge status={p.status} className="bg-card/90 backdrop-blur" />
                      {p.featured && (
                        <Badge className="gap-1 bg-primary text-primary-foreground">
                          <Sparkles className="h-3 w-3" /> Featured
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold leading-tight">{p.title}</h3>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {p.tagline || categoryLabel(p.category)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditing(p)}
                          aria-label={`Edit ${p.title}`}
                          title="Edit product and tiers"
                        >
                          <PenLine className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={`Actions for ${p.title}`}
                              disabled={busyId === p.id}
                            >
                              {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem onClick={() => navigate("product", { productId: p.id })}>
                              <Store className="h-4 w-4" /> View storefront
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void toggleStatus(p)}>
                              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                              {paused ? "Resume listing" : "Pause listing"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditing(p)}>
                              <Pencil className="h-4 w-4" /> Edit details & tiers
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" /> {fmtCompact(p.membersCount)} members
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Stars rating={p.rating} /> {p.rating.toFixed(1)}
                      </span>
                      <span>({p.reviewCount} reviews)</span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {p.accessType.map((a) => (
                        <ProviderBadge key={a} provider={a} />
                      ))}
                    </div>

                    <div className="mt-3 space-y-1.5 rounded-xl bg-muted/40 p-3">
                      {plans.slice(0, 4).map((plan) => (
                        <div key={plan.id} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate font-medium">{plan.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {fmtMoney(plan.priceCents)}/{plan.interval === "year" ? "yr" : "mo"}
                          </span>
                        </div>
                      ))}
                      {plans.length === 0 && <p className="text-xs text-muted-foreground">No pricing tiers</p>}
                    </div>

                    <div className="mt-auto flex items-center justify-between border-t pt-3 mt-3">
                      <span className="text-xs text-muted-foreground">MRR</span>
                      <span className="text-sm font-bold tabular-nums">{fmtMoney(mrr)}</span>
                    </div>
                  </div>
                </Panel>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <CreateProductDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          refresh();
        }}
      />
      <EditProductDialog product={editing} onOpenChange={(open) => !open && setEditing(null)} onSaved={replaceProduct} />
    </div>
  );
}

// ============================================================================
// Create product dialog (2-step)
// ============================================================================

function CreateProductDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [description, setDescription] = useState("");
  const [accessType, setAccessType] = useState<string[]>(["DISCORD"]);
  const [discordRoleName, setDiscordRoleName] = useState("");
  const [telegramChannel, setTelegramChannel] = useState("");
  const [tiers, setTiers] = useState<TierDraft[]>([{ ...EMPTY_TIER }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setStep(1);
      setTitle("");
      setTagline("");
      setCategory("OTHER");
      setDescription("");
      setAccessType(["DISCORD"]);
      setDiscordRoleName("");
      setTelegramChannel("");
      setTiers([{ ...EMPTY_TIER }]);
      setFormError(null);
      setBusy(false);
    }
  }, [open]);

  function toggleAccess(key: string) {
    setAccessType((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function updateTier(i: number, patch: Partial<TierDraft>) {
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  function goToPricing() {
    if (title.trim().length < 3) return setFormError("Give your product a title (at least 3 characters).");
    if (description.trim().length < 10) return setFormError("Add a description of at least 10 characters.");
    if (accessType.length === 0) return setFormError("Pick at least one way members get access.");
    if (accessType.includes("DISCORD") && !discordRoleName.trim())
      return setFormError("Enter the Discord role to grant on purchase.");
    if (accessType.includes("TELEGRAM") && !telegramChannel.trim())
      return setFormError("Enter the Telegram channel to invite buyers to.");
    setFormError(null);
    setStep(2);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const plans = tiers.map((t) => ({
      name: t.name.trim(),
      priceCents: Math.round(parseFloat(t.price) * 100),
      interval: t.interval,
      trialDays: Math.max(0, Math.min(30, Number(t.trialDays) || 0)),
      badge: t.badge.trim() || null,
      features: [] as string[],
    }));
    if (plans.some((p) => !p.name || !Number.isFinite(p.priceCents) || p.priceCents <= 0)) {
      setFormError("Every tier needs a name and a price above $0.");
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      await api("/api/products", {
        json: {
          title: title.trim(),
          tagline: tagline.trim(),
          description: description.trim(),
          category,
          accessType,
          discordRoleName: accessType.includes("DISCORD") ? discordRoleName.trim() : undefined,
          telegramChannel: accessType.includes("TELEGRAM") ? telegramChannel.trim() : undefined,
          plans,
        },
      });
      toast({
        title: "Product created",
        description: `${title.trim()} is live on the marketplace with ${plans.length} pricing tier${plans.length === 1 ? "" : "s"}.`,
      });
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't create the product", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === 1 ? "Create a product" : "Pricing tiers"}</DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Step 1 of 2 — the basics: what it is and how members get access."
              : "Step 2 of 2 — up to 4 tiers. Prices are in US dollars."}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="np-title">Title</Label>
              <Input
                id="np-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Trade Signals Pro"
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-tagline">Tagline</Label>
              <Input
                id="np-tagline"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="One line that sells it (optional)"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger aria-label="Category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np-desc">Description</Label>
              <Textarea
                id="np-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's included, who it's for, what members get…"
                rows={4}
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">How members get access</legend>
              <div className="grid grid-cols-2 gap-2">
                {ACCESS_OPTIONS.map((a) => {
                  const on = accessType.includes(a.key);
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => toggleAccess(a.key)}
                      aria-pressed={on}
                      className={cn(
                        "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors",
                        on
                          ? "border-primary bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <AnimatePresence initial={false}>
              {accessType.includes("DISCORD") && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="np-discord">Discord role to grant</Label>
                    <Input
                      id="np-discord"
                      value={discordRoleName}
                      onChange={(e) => setDiscordRoleName(e.target.value)}
                      placeholder="e.g. @Whale Room"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {accessType.includes("TELEGRAM") && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="np-telegram">Telegram channel</Label>
                    <Input
                      id="np-telegram"
                      value={telegramChannel}
                      onChange={(e) => setTelegramChannel(e.target.value)}
                      placeholder="e.g. @alphagroup"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="space-y-3">
            {tiers.map((t, i) => (
              <div key={i} className="space-y-2.5 rounded-xl border p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground">Tier {i + 1}</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-600"
                    onClick={() => setTiers((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={tiers.length === 1}
                    aria-label={`Remove tier ${i + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`tier-name-${i}`}>Name</Label>
                    <Input
                      id={`tier-name-${i}`}
                      value={t.name}
                      onChange={(e) => updateTier(i, { name: e.target.value })}
                      placeholder="Monthly"
                      maxLength={40}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`tier-price-${i}`}>Price (USD)</Label>
                    <Input
                      id={`tier-price-${i}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={t.price}
                      onChange={(e) => updateTier(i, { price: e.target.value })}
                      placeholder="49.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Interval</Label>
                    <Select
                      value={t.interval}
                      onValueChange={(v) => updateTier(i, { interval: v === "year" ? "year" : "month" })}
                    >
                      <SelectTrigger aria-label={`Interval for tier ${i + 1}`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="month">Monthly</SelectItem>
                        <SelectItem value="year">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`tier-trial-${i}`}>Trial days (optional)</Label>
                    <Input
                      id={`tier-trial-${i}`}
                      type="number"
                      min="0"
                      max="30"
                      value={t.trialDays}
                      onChange={(e) => updateTier(i, { trialDays: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={`tier-badge-${i}`}>Badge (optional)</Label>
                    <Input
                      id={`tier-badge-${i}`}
                      value={t.badge}
                      onChange={(e) => updateTier(i, { badge: e.target.value })}
                      placeholder="Most popular"
                      maxLength={24}
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              onClick={() => setTiers((prev) => (prev.length >= 4 ? prev : [...prev, { ...EMPTY_TIER }]))}
              disabled={tiers.length >= 4}
            >
              <Plus className="h-4 w-4" /> Add tier {tiers.length >= 4 && "(max 4)"}
            </Button>
          </div>
        )}

        {formError && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
            {formError}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 2 && (
            <Button type="button" variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
          )}
          {step === 1 ? (
            <Button type="button" onClick={goToPricing}>
              Continue to pricing <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" form="create-product-form" disabled={busy} onClick={(e) => void submit(e)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create product
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Edit product dialog (details + plans editor) — Task 8-b
// ============================================================================

/** Editable draft of a plan tier (price in dollars, features one per line). */
interface PlanDraft {
  name: string;
  price: string;
  interval: "month" | "year";
  trialDays: string;
  badge: string;
  features: string;
}

const EMPTY_PLAN_DRAFT: PlanDraft = { name: "", price: "", interval: "month", trialDays: "", badge: "", features: "" };

function draftFromPlan(plan: PlanDTO): PlanDraft {
  return {
    name: plan.name,
    price: (plan.priceCents / 100).toFixed(2),
    interval: plan.interval,
    trialDays: plan.trialDays ? String(plan.trialDays) : "",
    badge: plan.badge || "",
    features: plan.features.join("\n"),
  };
}

/** Client-side mirror of the plan validation (PATCH ignores bad fields silently). */
function parsePlanDraft(draft: PlanDraft): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const name = draft.name.trim();
  if (name.length < 2) return { ok: false, error: "Tier names need at least 2 characters." };
  const cents = Math.round(parseFloat(draft.price) * 100);
  if (!Number.isFinite(cents) || cents < 100 || cents > 1000000) {
    return { ok: false, error: "Price must be between $1 and $10,000." };
  }
  const features = draft.features.split("\n").map((s) => s.trim()).filter(Boolean);
  if (features.length > 8) return { ok: false, error: "Tiers can list at most 8 features." };
  return {
    ok: true,
    body: {
      name,
      priceCents: cents,
      interval: draft.interval,
      trialDays: Math.min(30, Math.max(0, Math.round(Number(draft.trialDays) || 0))),
      badge: draft.badge.trim(),
      features,
    },
  };
}

function EditProductDialog({
  product,
  onOpenChange,
  onSaved,
}: {
  product: ProductCardDTO | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (product: ProductDetailDTO) => void;
}) {
  const { toast } = useToast();
  const refresh = useAppStore((s) => s.refresh);

  // Fresh detail + plans are fetched every time the dialog opens (the public
  // GET includes the creator-only fields and active plans).
  const [detail, setDetail] = useState<ProductDetailDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<PlanDTO | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<"details" | "plans">("details");

  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [status, setStatus] = useState<"ACTIVE" | "PAUSED">("ACTIVE");
  const [featured, setFeatured] = useState(false);
  const [accessType, setAccessType] = useState<string[]>([]);
  const [discordRoleName, setDiscordRoleName] = useState("");
  const [telegramChannel, setTelegramChannel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!product) return;
    let alive = true;
    setDetail(null);
    setLoadError(null);
    setPlans([]);
    setPlanError(null);
    setConfirmPlan(null);
    setAddOpen(false);
    setTab("details");
    setFormError(null);
    setBusy(false);
    api<{ product: ProductDetailDTO }>(`/api/products/${product.id}`)
      .then((res) => {
        if (!alive) return;
        const d = res.product;
        setDetail(d);
        setPlans([...d.plans].sort((a, b) => a.sortOrder - b.sortOrder));
        setTitle(d.title);
        setTagline(d.tagline || "");
        setDescription(d.description);
        setCategory(d.category);
        setStatus(d.status === "PAUSED" ? "PAUSED" : "ACTIVE");
        setFeatured(d.featured);
        setAccessType(d.accessType);
        setDiscordRoleName(d.discordRoleName || "");
        setTelegramChannel(d.telegramChannel || "");
      })
      .catch((e) => {
        if (alive) setLoadError(e instanceof Error ? e.message : "Couldn't load the product.");
      });
    return () => {
      alive = false;
    };
  }, [product, loadNonce]);

  function toggleAccess(key: string) {
    setAccessType((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!product || !detail) return;
    if (title.trim().length < 3) return setFormError("Title needs at least 3 characters.");
    if (description.trim().length < 10) return setFormError("Description needs at least 10 characters.");
    if (accessType.length === 0) return setFormError("Pick at least one way members get access.");
    if (accessType.includes("DISCORD") && !discordRoleName.trim())
      return setFormError("Enter the Discord role to grant on purchase.");
    if (accessType.includes("TELEGRAM") && !telegramChannel.trim())
      return setFormError("Enter the Telegram channel to invite buyers to.");
    setFormError(null);
    setBusy(true);
    try {
      const res = await api<{ product: ProductDetailDTO }>(`/api/products/${product.id}`, {
        method: "PATCH",
        json: {
          title: title.trim(),
          tagline: tagline.trim(),
          description: description.trim(),
          category,
          status,
          featured,
          accessType,
          // Sending an empty string clears the field server-side.
          discordRoleName: accessType.includes("DISCORD") ? discordRoleName.trim() : "",
          telegramChannel: accessType.includes("TELEGRAM") ? telegramChannel.trim() : "",
        },
      });
      if (res.product) {
        setDetail(res.product);
        onSaved(res.product);
      }
      toast({ title: "Product updated", description: `${title.trim()} has been saved.` });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Couldn't save changes", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function togglePlanActive(plan: PlanDTO, next: boolean) {
    // Optimistic flip; revert + inline error on failure.
    setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, active: next } : p)));
    setPlanError(null);
    try {
      const res = await api<{ plan: PlanDTO }>(`/api/plans/${plan.id}`, { method: "PATCH", json: { active: next } });
      setPlans((prev) => prev.map((p) => (p.id === res.plan.id ? res.plan : p)));
      toast({
        title: next ? "Tier activated" : "Tier deactivated",
        description: next
          ? `${res.plan.name} is available to new subscribers again.`
          : `${res.plan.name} is hidden from checkout — existing subscribers keep their terms.`,
      });
      refresh();
    } catch (e) {
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, active: !next } : p)));
      // 400 = the server refused (e.g. last active plan) — surface inline.
      setPlanError((e as Error).message);
    }
  }

  async function savePlan(plan: PlanDTO, draft: PlanDraft): Promise<string | null> {
    const parsed = parsePlanDraft(draft);
    if (!parsed.ok) return parsed.error;
    try {
      const res = await api<{ plan: PlanDTO }>(`/api/plans/${plan.id}`, { method: "PATCH", json: parsed.body });
      setPlans((prev) => prev.map((p) => (p.id === res.plan.id ? res.plan : p)));
      toast({
        title: "Tier updated",
        description: `${res.plan.name} saved — price changes apply to new subscribers only.`,
      });
      setPlanError(null);
      refresh();
      return null;
    } catch (e) {
      // 409 duplicate names + 400 validation surface inline in the editor.
      return (e as Error).message;
    }
  }

  async function addPlan(draft: PlanDraft): Promise<string | null> {
    if (!product) return "No product selected.";
    const parsed = parsePlanDraft(draft);
    if (!parsed.ok) return parsed.error;
    try {
      const res = await api<{ plan: PlanDTO }>(`/api/products/${product.id}/plans`, { json: parsed.body });
      setPlans((prev) => [...prev, res.plan]);
      toast({ title: "Tier added", description: `${res.plan.name} is live on ${product.title}.` });
      setPlanError(null);
      setAddOpen(false);
      refresh();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {product?.title}</DialogTitle>
          <DialogDescription>Update the storefront listing and manage pricing tiers.</DialogDescription>
        </DialogHeader>

        {!detail ? (
          loadError ? (
            <div className="space-y-4">
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
                {loadError}
              </p>
              <Button variant="outline" className="w-full" onClick={() => setLoadNonce((n) => n + 1)}>
                <RotateCcw className="h-4 w-4" /> Try again
              </Button>
            </div>
          ) : (
            <div className="space-y-3" aria-busy="true" aria-label="Loading product">
              <div className="flex gap-2">
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-9 flex-1" />
              </div>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          )
        ) : (
          <>
            <Tabs value={tab} onValueChange={(v) => setTab(v === "plans" ? "plans" : "details")}>
              <TabsList className="w-full">
                <TabsTrigger value="details" className="flex-1">
                  <PenLine className="h-4 w-4" /> Details
                </TabsTrigger>
                <TabsTrigger value="plans" className="flex-1">
                  <Layers className="h-4 w-4" /> Plans · {plans.length}
                </TabsTrigger>
              </TabsList>

              {/* ---------- Details tab ---------- */}
              <TabsContent value="details" className="mt-4">
                <form id="edit-product-form" onSubmit={(e) => void save(e)} className="space-y-4">
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ep-title">Title</Label>
                      <Input id="ep-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ep-tagline">Tagline</Label>
                      <Input id="ep-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} />
                    </div>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Category</Label>
                      <Select value={category} onValueChange={setCategory}>
                        <SelectTrigger aria-label="Category" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.map((c) => (
                            <SelectItem key={c.key} value={c.key}>
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <Select value={status} onValueChange={(v) => setStatus(v === "PAUSED" ? "PAUSED" : "ACTIVE")}>
                        <SelectTrigger aria-label="Listing status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Active · listed</SelectItem>
                          <SelectItem value="PAUSED">Paused · hidden</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">Featured listing</span>
                      <span className="block text-xs text-muted-foreground">
                        Pin {detail.title} on the marketplace homepage.
                      </span>
                    </span>
                    <Switch checked={featured} onCheckedChange={setFeatured} aria-label="Feature this product on the homepage" />
                  </label>
                  <div className="space-y-1.5">
                    <Label htmlFor="ep-desc">Description</Label>
                    <Textarea id="ep-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
                  </div>
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">How members get access</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {ACCESS_OPTIONS.map((a) => {
                        const on = accessType.includes(a.key);
                        return (
                          <button
                            key={a.key}
                            type="button"
                            onClick={() => toggleAccess(a.key)}
                            aria-pressed={on}
                            className={cn(
                              "flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors",
                              on
                                ? "border-primary bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                          >
                            {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                            {a.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  <AnimatePresence initial={false}>
                    {accessType.includes("DISCORD") && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-1.5 pt-1">
                          <Label htmlFor="ep-discord">Discord role to grant</Label>
                          <Input
                            id="ep-discord"
                            value={discordRoleName}
                            onChange={(e) => setDiscordRoleName(e.target.value)}
                            placeholder="e.g. @Whale Room"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <AnimatePresence initial={false}>
                    {accessType.includes("TELEGRAM") && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-1.5 pt-1">
                          <Label htmlFor="ep-telegram">Telegram channel</Label>
                          <Input
                            id="ep-telegram"
                            value={telegramChannel}
                            onChange={(e) => setTelegramChannel(e.target.value)}
                            placeholder="e.g. @alphagroup"
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {formError && (
                    <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
                      {formError}
                    </p>
                  )}
                </form>
              </TabsContent>

              {/* ---------- Plans tab ---------- */}
              <TabsContent value="plans" className="mt-4 space-y-3.5">
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-xs leading-relaxed">
                    Price changes apply to new subscribers only — existing members keep their rate until they switch
                    tiers.
                  </p>
                </div>

                {planError && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
                    {planError}
                  </p>
                )}

                <div className="space-y-2.5">
                  {plans.map((plan) => (
                    <PlanTierRow
                      key={plan.id}
                      plan={plan}
                      onToggleActive={(p, next) => {
                        // Deactivation is destructive-ish → confirm first.
                        if (next) void togglePlanActive(p, true);
                        else setConfirmPlan(p);
                      }}
                      onSave={savePlan}
                    />
                  ))}
                  {plans.length === 0 && (
                    <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                      No active tiers — add one below so buyers can subscribe.
                    </p>
                  )}
                </div>

                {addOpen ? (
                  <AddTierForm onAdd={addPlan} onCancel={() => setAddOpen(false)} />
                ) : (
                  <Button
                    variant="outline"
                    className="w-full border-dashed"
                    onClick={() => setAddOpen(true)}
                    disabled={plans.length >= 6}
                  >
                    <Plus className="h-4 w-4" /> Add tier{plans.length >= 6 ? " (max 6)" : ""}
                  </Button>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Deactivated tiers stay live for existing subscribers but are hidden from checkout — and from this list
                  once you close the dialog.
                </p>
              </TabsContent>
            </Tabs>

            {tab === "details" && (
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" form="edit-product-form" disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
                </Button>
              </DialogFooter>
            )}
          </>
        )}

        {/* Deactivation confirm — the server also guards the last active plan. */}
        <AlertDialog open={!!confirmPlan} onOpenChange={(o) => !o && setConfirmPlan(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Deactivate this tier?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmPlan?.name} will disappear from checkout on {detail?.title}. Existing subscribers keep their
                terms and renewals. You can reactivate it anytime.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep tier</AlertDialogCancel>
              <AlertDialogAction
                className="bg-amber-600 text-white hover:bg-amber-700"
                onClick={() => {
                  const p = confirmPlan;
                  setConfirmPlan(null);
                  if (p) void togglePlanActive(p, false);
                }}
              >
                Deactivate tier
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/** One plan tier row: summary + active switch + inline pencil editor. */
function PlanTierRow({
  plan,
  onToggleActive,
  onSave,
}: {
  plan: PlanDTO;
  onToggleActive: (plan: PlanDTO, next: boolean) => void;
  onSave: (plan: PlanDTO, draft: PlanDraft) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className={cn("rounded-xl border bg-background/40", !plan.active && "opacity-75")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold leading-tight">{plan.name}</p>
            {plan.badge && (
              <Badge
                variant="outline"
                className="border-primary/25 bg-primary/10 px-2 py-0 text-[10px] font-semibold text-primary"
              >
                {plan.badge}
              </Badge>
            )}
            {!plan.active && (
              <Badge
                variant="outline"
                className="border-amber-500/25 bg-amber-500/10 px-2 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              >
                Inactive
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {fmtMoney(plan.priceCents, { cents: true })}/{plan.interval === "year" ? "yr" : "mo"}
            {plan.trialDays > 0 && ` · ${plan.trialDays}-day trial`}
            {` · ${plan.features.length} feature${plan.features.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-label={`Edit the ${plan.name} tier`}
          >
            <PenLine className="h-4 w-4" />
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch
              checked={plan.active}
              onCheckedChange={(v) => onToggleActive(plan, v)}
              aria-label={`${plan.active ? "Deactivate" : "Activate"} the ${plan.name} tier`}
            />
            {plan.active ? "Active" : "Inactive"}
          </label>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t px-3.5 py-3.5">
              <PlanTierEditor plan={plan} onSave={onSave} onDone={() => setEditing(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Inline editor for one plan tier (name, price, interval, trial, badge, features). */
function PlanTierEditor({
  plan,
  onSave,
  onDone,
}: {
  plan: PlanDTO;
  onSave: (plan: PlanDTO, draft: PlanDraft) => Promise<string | null>;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<PlanDraft>(() => draftFromPlan(plan));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(p: Partial<PlanDraft>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const err = await onSave(plan, draft);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`plan-name-${plan.id}`}>Name</Label>
          <Input
            id={`plan-name-${plan.id}`}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            maxLength={40}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`plan-price-${plan.id}`}>Price (USD)</Label>
          <Input
            id={`plan-price-${plan.id}`}
            type="number"
            min="1"
            step="0.01"
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => patch({ price: e.target.value })}
            placeholder="49.00"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Interval</Label>
          <Select value={draft.interval} onValueChange={(v) => patch({ interval: v === "year" ? "year" : "month" })}>
            <SelectTrigger aria-label={`Interval for ${plan.name}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="year">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`plan-trial-${plan.id}`}>Trial days</Label>
          <Input
            id={`plan-trial-${plan.id}`}
            type="number"
            min="0"
            max="30"
            value={draft.trialDays}
            onChange={(e) => patch({ trialDays: e.target.value })}
            placeholder="0"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`plan-badge-${plan.id}`}>Badge (optional)</Label>
          <Input
            id={`plan-badge-${plan.id}`}
            value={draft.badge}
            onChange={(e) => patch({ badge: e.target.value })}
            placeholder="Most popular"
            maxLength={20}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`plan-features-${plan.id}`}>Features — one per line, max 8</Label>
        <Textarea
          id={`plan-features-${plan.id}`}
          value={draft.features}
          onChange={(e) => patch({ features: e.target.value })}
          rows={3}
          placeholder={"Daily trade signals\nPrivate community access"}
        />
      </div>
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save tier
        </Button>
      </div>
    </form>
  );
}

/** "+ Add tier" expansion — POSTs a new plan to the product. */
function AddTierForm({
  onAdd,
  onCancel,
}: {
  onAdd: (draft: PlanDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PlanDraft>({ ...EMPTY_PLAN_DRAFT });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function patch(p: Partial<PlanDraft>) {
    setDraft((prev) => ({ ...prev, ...p }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const err = await onAdd(draft);
    setBusy(false);
    // On success the parent collapses (and remounts fresh next time).
    if (err) setError(err);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2.5 rounded-xl border border-dashed p-3.5">
      <p className="text-xs font-semibold text-muted-foreground">New tier</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="new-plan-name">Name</Label>
          <Input
            id="new-plan-name"
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Monthly"
            maxLength={40}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-plan-price">Price (USD)</Label>
          <Input
            id="new-plan-price"
            type="number"
            min="1"
            step="0.01"
            inputMode="decimal"
            value={draft.price}
            onChange={(e) => patch({ price: e.target.value })}
            placeholder="49.00"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Interval</Label>
          <Select value={draft.interval} onValueChange={(v) => patch({ interval: v === "year" ? "year" : "month" })}>
            <SelectTrigger aria-label="Interval for the new tier" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="year">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-plan-trial">Trial days</Label>
          <Input
            id="new-plan-trial"
            type="number"
            min="0"
            max="30"
            value={draft.trialDays}
            onChange={(e) => patch({ trialDays: e.target.value })}
            placeholder="0"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="new-plan-badge">Badge (optional)</Label>
          <Input
            id="new-plan-badge"
            value={draft.badge}
            onChange={(e) => patch({ badge: e.target.value })}
            placeholder="Most popular"
            maxLength={20}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-plan-features">Features — one per line, max 8</Label>
        <Textarea
          id="new-plan-features"
          value={draft.features}
          onChange={(e) => patch({ features: e.target.value })}
          rows={3}
          placeholder={"Daily trade signals\nPrivate community access"}
        />
      </div>
      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add tier
        </Button>
      </div>
    </form>
  );
}

// ============================================================================
// TAB: SUBSCRIBERS (CRM)
// ============================================================================

interface SubscriberRow {
  id: string;
  customer: {
    id: string;
    name: string | null;
    email: string;
    avatarColor: string;
    discordHandle: string | null;
    telegramHandle: string | null;
  };
  product: { id: string; title: string; coverTheme: string };
  plan: PlanDTO;
  status: string;
  gateway: string;
  cancelAtPeriodEnd: boolean;
  dunningAttempts: number;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  createdAt: string;
  lifetimeValueCents: number;
  paymentMethod: SubPaymentMethod | null;
}

const SUBSCRIBER_SEGMENTS: { key: string; label: string; test: (s: SubscriberRow) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "active", label: "Active", test: (s) => s.status === "ACTIVE" && !s.cancelAtPeriodEnd },
  { key: "trialing", label: "Trialing", test: (s) => s.status === "TRIALING" },
  { key: "past_due", label: "Past due", test: (s) => s.status === "PAST_DUE" },
  { key: "canceling", label: "Canceling", test: (s) => s.cancelAtPeriodEnd || s.status === "CANCELED" },
];

function SubscribersTab() {
  const { data, error, loading } = useCreatorFetch(() =>
    api<{ subscribers: SubscriberRow[] }>("/api/creator/subscribers").then((r) => r.subscribers)
  );
  const [segment, setSegment] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) return <TableSkeleton rows={7} label="Subscribers" />;
  if (error || !data) return <LoadError message={error || "Subscribers unavailable."} />;

  const subs = data;
  const active = SUBSCRIBER_SEGMENTS.find((s) => s.key === segment) || SUBSCRIBER_SEGMENTS[0];
  const filtered = subs.filter(active.test);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Subscribers"
        description={`${subs.length} member${subs.length === 1 ? "" : "s"} across your products`}
      />

      {/* Segment chips */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter subscribers">
        {SUBSCRIBER_SEGMENTS.map((seg) => {
          const on = seg.key === segment;
          const count = subs.filter(seg.test).length;
          return (
            <button
              key={seg.key}
              onClick={() => setSegment(seg.key)}
              aria-pressed={on}
              className={cn(
                "flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors",
                on
                  ? "border-primary bg-primary text-primary-foreground shadow-sm"
                  : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {seg.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                  on ? "bg-primary-foreground/20" : "bg-muted"
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {subs.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No subscribers yet"
          description="Members who purchase your products will appear here with their plan, payment method and lifetime value."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={`No ${active.label.toLowerCase()} subscribers`}
          description="Try a different segment to see more members."
        />
      ) : (
        <Panel className="overflow-hidden">
          <div className={cn("max-h-[70vh] overflow-auto", SCROLL_THIN)}>
            <table className="w-full min-w-[920px] text-sm">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Customer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Next renewal</TableHead>
                  <TableHead className="text-right">LTV</TableHead>
                  <TableHead className="w-12" aria-label="Expand" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const expanded = expandedId === s.id;
                  return (
                    <>
                      <TableRow
                        key={s.id}
                        className="cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : s.id)}
                        aria-expanded={expanded}
                      >
                        <TableCell className="pl-5">
                          <div className="flex items-center gap-2.5">
                            <UserAvatar name={s.customer.name || s.customer.email} color={s.customer.avatarColor} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium">{s.customer.name || s.customer.email}</p>
                              <p className="truncate text-xs text-muted-foreground">{s.customer.email}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <ProductCover
                              theme={s.product.coverTheme}
                              category="OTHER"
                              title={s.product.title}
                              className="h-8 w-11 shrink-0 rounded-md"
                              iconClassName="h-9 w-9"
                            />
                            <span className="max-w-[150px] truncate text-[13px]">{s.product.title}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="text-[13px] font-medium">{s.plan.name}</p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {fmtMoney(s.plan.priceCents)}/{s.plan.interval === "year" ? "yr" : "mo"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={s.status} />
                        </TableCell>
                        <TableCell>
                          <GatewayBadge gateway={s.gateway} />
                        </TableCell>
                        <TableCell>
                          <p className="text-[13px] tabular-nums">{fmtDate(s.currentPeriodEnd)}</p>
                          {s.cancelAtPeriodEnd && s.status !== "CANCELED" && (
                            <span className="mt-0.5 inline-block rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                              Cancels {fmtDate(s.currentPeriodEnd)}
                            </span>
                          )}
                          {s.status === "TRIALING" && s.trialEndsAt && (
                            <span className="mt-0.5 inline-block rounded-full border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-400">
                              Trial ends {fmtDate(s.trialEndsAt)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {fmtMoney(s.lifetimeValueCents)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={expanded ? "Collapse details" : "Expand details"}
                            aria-expanded={expanded}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(expanded ? null : s.id);
                            }}
                          >
                            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expanded && (
                        <TableRow key={`${s.id}-detail`} className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={8} className="px-5 py-4">
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.2 }}
                              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
                            >
                              <DetailBlock icon={CreditCard} label="Payment method" value={pmLine(s.paymentMethod)} />
                              <DetailBlock icon={Users} label="Discord" value={s.customer.discordHandle || "Not linked"} />
                              <DetailBlock icon={Send} label="Telegram" value={s.customer.telegramHandle || "Not linked"} />
                              <DetailBlock
                                icon={TriangleAlert}
                                label="Dunning attempts"
                                value={
                                  s.dunningAttempts > 0
                                    ? `${s.dunningAttempts} of 3 retries`
                                    : s.status === "PAST_DUE"
                                      ? "Retries starting"
                                      : "None"
                                }
                                tone={s.dunningAttempts > 0 ? "warning" : undefined}
                              />
                              <DetailBlock icon={CalendarRange} label="Member since" value={fmtDate(s.createdAt)} />
                            </motion.div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

function DetailBlock({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "warning";
}) {
  return (
    <div className={cn("rounded-xl border bg-background/70 p-3", tone === "warning" && "border-amber-500/40")}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", tone === "warning" && "text-amber-500")} />
        {label}
      </p>
      <p className={cn("mt-1 truncate text-sm font-medium tabular-nums", tone === "warning" && "text-amber-700 dark:text-amber-400")}>
        {value}
      </p>
    </div>
  );
}

// ============================================================================
// TAB: ORDERS
// ============================================================================

interface OrderRow {
  id: string;
  number: string;
  customer: { id: string; name: string | null; email: string; avatarColor: string };
  product: { id: string; title: string; coverTheme: string };
  planName: string;
  description: string;
  amountCents: number;
  status: string;
  gateway: string;
  createdAt: string;
  paidAt: string | null;
}

function OrdersTab() {
  const now = useSimNow();
  const { toast } = useToast();
  const { data, error, loading } = useCreatorFetch(() =>
    api<{ orders: OrderRow[] }>("/api/creator/orders").then((r) => r.orders)
  );
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<OrderRow | null>(null);

  const nowMs = useMemo(() => new Date(now).getTime(), [now]);

  if (loading) return <TableSkeleton rows={7} label="Orders" />;
  if (error || !data) return <LoadError message={error || "Orders unavailable."} />;

  const orders = data;
  const paid = orders.filter((o) => o.status === "PAID");
  const grossVolume = paid.reduce((s, o) => s + o.amountCents, 0);
  const failedCount = orders.filter((o) => o.status === "FAILED").length;
  const net30 = paid
    .filter((o) => new Date(o.createdAt).getTime() >= nowMs - 30 * 86400000)
    .reduce((s, o) => s + o.amountCents, 0);

  const q = query.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    if (statusFilter !== "ALL" && o.status !== statusFilter) return false;
    if (!q) return true;
    return (
      (o.customer.name || "").toLowerCase().includes(q) ||
      o.product.title.toLowerCase().includes(q) ||
      o.planName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <SectionHeader title="Orders" description={`${orders.length} invoice${orders.length === 1 ? "" : "s"} across your products`} />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Gross volume" value={fmtMoney(grossVolume)} sub={`${paid.length} paid invoices`} icon={DollarSign} />
        <StatCard
          label="Failed charges"
          value={String(failedCount)}
          sub={failedCount > 0 ? "retrying via dunning" : "all clear"}
          icon={XCircle}
          className={cn(failedCount > 0 && "border-red-500/40 bg-red-500/[0.04]")}
        />
        <StatCard label="Net · 30 days" value={fmtMoney(net30)} sub="successful charges" icon={ReceiptText} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5 rounded-full border bg-card p-1" role="group" aria-label="Filter by status">
          {(["ALL", "PAID", "FAILED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={cn(
                "h-8 rounded-full px-3.5 text-xs font-semibold transition-colors",
                statusFilter === s
                  ? s === "FAILED"
                    ? "bg-red-500/15 text-red-700 dark:text-red-400"
                    : "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s === "ALL" ? "All" : s === "PAID" ? "Paid" : "Failed"}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer or product…"
            className="h-9 rounded-full pl-9"
            aria-label="Search orders"
          />
        </div>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No orders yet"
          description="Invoices from purchases and renewals will appear here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matching orders"
          description="Try clearing the search or switching the status filter."
        />
      ) : (
        <Panel className="overflow-hidden">
          <div className={cn("max-h-[70vh] overflow-auto", SCROLL_THIN)}>
            <table className="w-full min-w-[860px] text-sm">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-5 text-right">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => setSelected(o)}>
                    <TableCell className="pl-5 font-mono text-[13px] font-medium">{o.number}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <UserAvatar name={o.customer.name || o.customer.email} color={o.customer.avatarColor} size="sm" />
                        <span className="max-w-[140px] truncate text-[13px] font-medium">
                          {o.customer.name || o.customer.email}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[180px] truncate text-[13px]">{o.product.title}</p>
                      <p className="text-xs text-muted-foreground">{o.planName}</p>
                    </TableCell>
                    <TableCell>
                      <GatewayBadge gateway={o.gateway} />
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(o.amountCents)}</TableCell>
                    <TableCell>
                      <StatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="pr-5 text-right text-xs tabular-nums text-muted-foreground">
                      {fmtDateTime(o.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        </Panel>
      )}

      {/* Invoice detail */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2.5 font-mono">
                  {selected.number}
                  <StatusBadge status={selected.status} />
                </DialogTitle>
                <DialogDescription>Invoice detail</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 rounded-xl border p-3">
                  <UserAvatar name={selected.customer.name || selected.customer.email} color={selected.customer.avatarColor} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{selected.customer.name || selected.customer.email}</p>
                    <p className="truncate text-xs text-muted-foreground">{selected.customer.email}</p>
                  </div>
                </div>
                <dl className="space-y-2.5">
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Product</dt>
                    <dd className="text-right font-medium">
                      {selected.product.title}
                      <span className="block text-xs font-normal text-muted-foreground">{selected.planName} plan</span>
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">Description</dt>
                    <dd className="max-w-[65%] text-right">{selected.description}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Gateway</dt>
                    <dd>
                      <GatewayBadge gateway={selected.gateway} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Issued</dt>
                    <dd className="tabular-nums">{fmtDateTime(selected.createdAt)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Paid</dt>
                    <dd className="tabular-nums">{selected.paidAt ? fmtDateTime(selected.paidAt) : "—"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t pt-3">
                    <dt className="font-semibold">Total</dt>
                    <dd className="text-lg font-bold tabular-nums">{fmtMoney(selected.amountCents)}</dd>
                  </div>
                </dl>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <CopyButton value={selected.number} label="Copy number" />
                <Button
                  variant="outline"
                  onClick={() =>
                    toast({
                      title: "Refunds are simulated in this demo",
                      description: "In production this would issue a prorated refund and fire invoice.refunded.",
                    })
                  }
                >
                  <RotateCcw className="h-4 w-4" /> Refund (simulated)
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// TAB: PROMOS (discount codes)
// ============================================================================

interface PromoRow extends PromoCodeDTO {
  discountGivenCents: number;
}

/** Client-side code generator matching the server's alphabet (no ambiguous chars). */
function generatePromoCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function promoValueLabel(p: PromoRow): string {
  return p.kind === "PERCENT" ? `${p.value}% OFF` : `${fmtMoney(p.value)} OFF`;
}

function promoDurationLabel(months: number): string {
  return months <= 1 ? "First invoice only" : `Applies to ${months} invoices`;
}

function promoStatus(p: PromoRow, nowMs: number): { expired: boolean; exhausted: boolean; muted: boolean } {
  const expired = !!p.expiresAt && new Date(p.expiresAt).getTime() <= nowMs;
  const exhausted = p.maxRedemptions > 0 && p.timesRedeemed >= p.maxRedemptions;
  return { expired, exhausted, muted: expired || exhausted || !p.active };
}

function PromosTab({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const refresh = useAppStore((s) => s.refresh);
  const now = useSimNow();

  // Products feed the "applies to" select in the create dialog — same catalog
  // call (creator filter) the products tab already uses.
  const { data, error, loading, setData } = useCreatorFetch(async () => {
    const [promosRes, productsRes] = await Promise.all([
      api<{ promos: PromoRow[] }>("/api/promos"),
      api<{ products: ProductCardDTO[] }>(`/api/products?creatorId=${user.id}`),
    ]);
    return { promos: promosRes.promos, products: productsRes.products };
  });

  const [createOpen, setCreateOpen] = useState(false);

  const nowMs = useMemo(() => new Date(now).getTime(), [now]);

  async function togglePromo(promo: PromoRow, next: boolean) {
    // Optimistic flip; revert on failure.
    setData((prev) =>
      prev
        ? { ...prev, promos: prev.promos.map((p) => (p.id === promo.id ? { ...p, active: next } : p)) }
        : prev
    );
    try {
      await api(`/api/promos/${promo.id}`, { method: "PATCH", json: { active: next } });
      toast({
        title: next ? "Promo code activated" : "Promo code paused",
        description: next
          ? `${promo.code} is accepted at checkout again.`
          : `${promo.code} will be rejected at checkout until reactivated.`,
      });
    } catch (e) {
      setData((prev) =>
        prev
          ? { ...prev, promos: prev.promos.map((p) => (p.id === promo.id ? { ...p, active: !next } : p)) }
          : prev
      );
      toast({ title: "Couldn't update the code", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function deletePromo(promo: PromoRow) {
    try {
      await api(`/api/promos/${promo.id}`, { method: "DELETE" });
      toast({
        title: "Promo code deleted",
        description: `${promo.code} and its ${promo.timesRedeemed} redemption record${
          promo.timesRedeemed === 1 ? "" : "s"
        } were removed.`,
      });
      setData((prev) => (prev ? { ...prev, promos: prev.promos.filter((p) => p.id !== promo.id) } : prev));
    } catch (e) {
      toast({ title: "Couldn't delete the code", description: (e as Error).message, variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading promo codes">
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) return <LoadError message={error || "Promo codes unavailable."} />;

  const { promos, products } = data;
  const activeCodes = promos.filter((p) => !promoStatus(p, nowMs).muted).length;
  const totalRedemptions = promos.reduce((s, p) => s + p.timesRedeemed, 0);
  const totalGiven = promos.reduce((s, p) => s + p.discountGivenCents, 0);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Promos"
        description={`${promos.length} code${promos.length === 1 ? "" : "s"} · ${activeCodes} live at checkout`}
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Create code
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active codes" value={String(activeCodes)} sub={`${promos.length} total`} icon={Tag} />
        <StatCard label="Total redemptions" value={String(totalRedemptions)} sub="across all codes" icon={Repeat} />
        <StatCard
          label="Discount given"
          value={fmtMoney(totalGiven, { cents: true })}
          sub="lifetime"
          icon={BadgePercent}
        />
      </div>

      {/* Codes */}
      {promos.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No promo codes yet"
          description="Create a code to run launch discounts, reward members or drive a seasonal sale — buyers apply it right in checkout."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> Create your first promo code
            </Button>
          }
        />
      ) : (
        <motion.div className="grid gap-5 md:grid-cols-2" variants={stagger} initial="hidden" animate="show">
          {promos.map((p) => {
            const st = promoStatus(p, nowMs);
            const usage = p.maxRedemptions > 0 ? Math.min(100, (p.timesRedeemed / p.maxRedemptions) * 100) : 0;
            return (
              <motion.div key={p.id} variants={fadeUp}>
                <Panel className={cn("flex h-full flex-col p-5 transition-shadow hover:shadow-md", st.muted && "opacity-70")}>
                  {/* Code + badges */}
                  <div className="flex items-center gap-1.5">
                    <span className="select-all font-mono text-xl font-bold tracking-[0.08em]">{p.code}</span>
                    <CopyButton value={p.code} label="Copy" />
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        p.kind === "PERCENT"
                          ? "border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
                          : "border-amber-500/25 bg-amber-500/12 text-amber-700 dark:text-amber-400"
                      )}
                    >
                      {promoValueLabel(p)}
                    </span>
                    {st.expired && <StatusBadge status="EXPIRED" />}
                    {st.exhausted && (
                      <Badge
                        variant="outline"
                        className="border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                      >
                        Fully redeemed
                      </Badge>
                    )}
                    {!p.active && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      >
                        Inactive
                      </Badge>
                    )}
                  </div>

                  {/* Meta */}
                  <dl className="mt-4 grid gap-x-4 gap-y-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Package className="h-3.5 w-3.5 shrink-0" />
                      <dt className="sr-only">Scope</dt>
                      <dd className="truncate" title={p.productTitle || "All products"}>
                        {p.productTitle || "All products"}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                      <dt className="sr-only">Duration</dt>
                      <dd>{promoDurationLabel(p.durationMonths)}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                      <dt className="sr-only">Expiry</dt>
                      <dd>
                        {p.expiresAt
                          ? st.expired
                            ? `Expired ${fmtDate(p.expiresAt)}`
                            : `Expires ${fmtDate(p.expiresAt)}`
                          : "No expiry"}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <BadgePercent className="h-3.5 w-3.5 shrink-0" />
                      <dt className="sr-only">Discount given</dt>
                      <dd className="tabular-nums">{fmtMoney(p.discountGivenCents, { cents: true })} given</dd>
                    </div>
                  </dl>

                  {/* Usage */}
                  <div className="mt-4">
                    {p.maxRedemptions > 0 ? (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">Usage</span>
                          <span className="tabular-nums text-muted-foreground">
                            {p.timesRedeemed} / {p.maxRedemptions} redemptions
                          </span>
                        </div>
                        <Progress
                          value={usage}
                          className="mt-1.5 h-2 transition-all"
                          aria-label={`${p.code}: ${p.timesRedeemed} of ${p.maxRedemptions} redemptions used`}
                        />
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        <span className="font-semibold tabular-nums text-foreground">{p.timesRedeemed}</span>{" "}
                        redemption{p.timesRedeemed === 1 ? "" : "s"} · unlimited
                      </p>
                    )}
                  </div>

                  {/* Footer actions */}
                  <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3.5">
                    <span className="text-xs text-muted-foreground">Created {fmtDate(p.createdAt)}</span>
                    <div className="flex items-center gap-1">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-red-600"
                            aria-label={`Delete ${p.code}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this promo code?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {p.code} will stop working immediately and its {p.timesRedeemed} redemption record
                              {p.timesRedeemed === 1 ? "" : "s"} will be permanently removed. Members who already
                              redeemed it keep their granted discounts.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep code</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-600 text-white hover:bg-red-700"
                              onClick={() => void deletePromo(p)}
                            >
                              Delete code
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                        <Switch
                          checked={p.active}
                          onCheckedChange={(v) => void togglePromo(p, v)}
                          aria-label={`${p.active ? "Pause" : "Activate"} ${p.code}`}
                        />
                        {p.active ? "Active" : "Paused"}
                      </label>
                    </div>
                  </div>
                </Panel>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      <CreatePromoDialog open={createOpen} onOpenChange={setCreateOpen} products={products} onCreated={() => refresh()} />
    </div>
  );
}

// ============================================================================
// Create promo dialog
// ============================================================================

function CreatePromoDialog({
  open,
  onOpenChange,
  onCreated,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  products: ProductCardDTO[];
}) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [value, setValue] = useState("");
  const [productId, setProductId] = useState("ALL");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [durationMonths, setDurationMonths] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setCode("");
      setKind("PERCENT");
      setValue("");
      setProductId("ALL");
      setMaxRedemptions("");
      setDurationMonths("1");
      setExpiresAt("");
      setFormError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed && !/^[A-Z0-9-]{3,24}$/.test(trimmed)) {
      return setFormError("Codes use 3–24 letters, numbers and dashes.");
    }
    let discountValue: number;
    if (kind === "PERCENT") {
      const pct = Number(value);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return setFormError("Enter a percent between 1 and 100.");
      discountValue = Math.round(pct);
    } else {
      const dollars = Number(value);
      if (!Number.isFinite(dollars) || dollars <= 0) return setFormError("Enter a dollar amount greater than $0.");
      discountValue = Math.round(dollars * 100); // 2 decimals → cents
      if (discountValue > 100000) return setFormError("Fixed discounts can't exceed $1,000.");
    }
    setFormError(null);
    setBusy(true);
    try {
      const res = await api<{ promo: PromoRow }>("/api/promos", {
        json: {
          code: trimmed || undefined, // server auto-generates when empty
          kind,
          value: discountValue,
          productId,
          maxRedemptions: Math.max(0, Math.round(Number(maxRedemptions) || 0)),
          durationMonths: Number(durationMonths) || 1,
          expiresAt: expiresAt || undefined,
        },
      });
      toast({
        title: "Promo code created",
        description: `${res.promo.code} is live — buyers can apply it at checkout.`,
      });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      // 409 duplicates and 400 validation errors surface inline.
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a promo code</DialogTitle>
          <DialogDescription>
            Discounts apply per invoice for as long as the duration lasts — percent or fixed amount.
          </DialogDescription>
        </DialogHeader>
        <form id="create-promo-form" onSubmit={(e) => void submit(e)} className="space-y-4">
          {/* Code */}
          <div className="space-y-1.5">
            <Label htmlFor="promo-code">Code</Label>
            <div className="flex gap-2">
              <Input
                id="promo-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Auto-generated if empty"
                maxLength={24}
                className="font-mono uppercase tracking-[0.08em]"
                autoComplete="off"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-11 shrink-0"
                onClick={() => setCode(generatePromoCode())}
                aria-label="Generate a random code"
                title="Generate a random code"
              >
                <Dices className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Leave empty and Vendly generates a unique 8-character code — or roll the dice.
            </p>
          </div>

          {/* Kind + value */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Discount type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v === "FIXED" ? "FIXED" : "PERCENT")}>
                <SelectTrigger aria-label="Discount type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">Percent off</SelectItem>
                  <SelectItem value="FIXED">Fixed amount off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="promo-value">{kind === "PERCENT" ? "Discount" : "Amount (USD)"}</Label>
              <div className="relative">
                {kind === "FIXED" && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                )}
                <Input
                  id="promo-value"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={kind === "PERCENT" ? "20" : "10.00"}
                  className={cn(kind === "FIXED" && "pl-7", kind === "PERCENT" && "pr-8")}
                />
                {kind === "PERCENT" && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Product scope */}
          <div className="space-y-1.5">
            <Label>Applies to</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger aria-label="Product scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All products</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Scoping to one product rejects the code everywhere else.
            </p>
          </div>

          {/* Max redemptions + duration */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="promo-max">Max redemptions</Label>
              <Input
                id="promo-max"
                type="number"
                min="0"
                value={maxRedemptions}
                onChange={(e) => setMaxRedemptions(e.target.value)}
                placeholder="Unlimited"
              />
              <p className="text-[11px] text-muted-foreground">0 or empty = unlimited.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <Select value={durationMonths} onValueChange={setDurationMonths}>
                <SelectTrigger aria-label="Duration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">First invoice only</SelectItem>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      Applies to {m} invoices
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Expiry */}
          <div className="space-y-1.5">
            <Label htmlFor="promo-expiry">Expiry date (optional)</Label>
            <Input
              id="promo-expiry"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              The code stops working after this date — leave empty for no expiry.
            </p>
          </div>

          {formError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-promo-form" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tag className="h-4 w-4" />} Create code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB: AFFILIATES (creator-run referral programs) — Task 8-b
// ============================================================================

/** 3000 bps → "30%" (used for badges, toasts and dialogs). */
function commissionLabel(bps: number): string {
  return `${parseFloat((bps / 100).toFixed(2))}%`;
}

/** Percent input → commissionBps (1–90%, up to 2 decimals); null when invalid. */
function percentToBps(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 90) return null;
  const bps = Math.round(n * 100);
  if (Math.abs(n * 100 - bps) > 1e-9) return null;
  return bps;
}

/** Referral link format shared with the marketplace (see worklog Task 7). */
function referralLink(code: string, productId: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/?ref=${code}&product=${productId}`;
}

function AffiliatesTab({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const refresh = useAppStore((s) => s.refresh);
  const navigate = useAppStore((s) => s.navigate);

  const { data, error, loading, setData } = useCreatorFetch(async () => {
    const [programsRes, productsRes] = await Promise.all([
      api<{ programs: AffiliateProgramDTO[] }>("/api/affiliates/programs"),
      api<{ products: ProductCardDTO[] }>(`/api/products?creatorId=${user.id}`),
    ]);
    return { programs: programsRes.programs, products: productsRes.products };
  });

  const [manage, setManage] = useState<AffiliateProgramDTO | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [confirmPause, setConfirmPause] = useState<AffiliateProgramDTO | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const [launchDrafts, setLaunchDrafts] = useState<Record<string, string>>({});

  // Memoized so the launch dialog's open-effect doesn't reset on every render.
  const programProductIds = useMemo(
    () => new Set((data?.programs ?? []).map((p) => p.product.id)),
    [data]
  );
  const notRunning = useMemo(
    () => (data?.products ?? []).filter((p) => !programProductIds.has(p.id)),
    [data, programProductIds]
  );

  async function toggleProgram(program: AffiliateProgramDTO, next: boolean) {
    // Optimistic flip; revert + destructive toast on failure.
    setData((prev) =>
      prev
        ? { ...prev, programs: prev.programs.map((p) => (p.id === program.id ? { ...p, active: next } : p)) }
        : prev
    );
    try {
      await api("/api/affiliates/programs", {
        json: { productId: program.product.id, commissionBps: program.commissionBps, active: next },
      });
      toast({
        title: next ? "Program resumed" : "Program paused",
        description: next
          ? `Affiliates can join and share ${program.product.title} again.`
          : `${program.product.title}'s referral links stop tracking until you resume the program.`,
      });
    } catch (e) {
      setData((prev) =>
        prev
          ? { ...prev, programs: prev.programs.map((p) => (p.id === program.id ? { ...p, active: !next } : p)) }
          : prev
      );
      toast({ title: "Couldn't update the program", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function launchProgram(p: ProductCardDTO, rawPercent: string) {
    const bps = percentToBps(rawPercent || "25");
    if (bps === null) {
      toast({
        title: "Couldn't launch the program",
        description: "Commission must be a percent between 1 and 90.",
        variant: "destructive",
      });
      return;
    }
    setLaunchingId(p.id);
    try {
      await api("/api/affiliates/programs", { json: { productId: p.id, commissionBps: bps, active: true } });
      toast({
        title: "Affiliate program launched",
        description: `Affiliates now earn ${commissionLabel(bps)} of the first invoice for ${p.title}.`,
      });
      setLaunchDrafts((prev) => {
        const next = { ...prev };
        delete next[p.id];
        return next;
      });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't launch the program", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLaunchingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading affiliate programs">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-80 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) return <LoadError message={error || "Affiliate programs unavailable."} />;

  const { programs, products } = data;
  const activePrograms = programs.filter((p) => p.active).length;
  const totalAffiliates = programs.reduce((s, p) => s + p.affiliateCount, 0);
  const totalPaid = programs.reduce((s, p) => s + p.paidCents, 0);
  const totalPending = programs.reduce((s, p) => s + p.pendingCents, 0);
  const totalClicks = programs.reduce((s, p) => s + p.totalClicks, 0);
  const totalConversions = programs.reduce((s, p) => s + p.totalConversions, 0);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Affiliates"
        description={`${programs.length} program${programs.length === 1 ? "" : "s"} · ${totalAffiliates} affiliate${
          totalAffiliates === 1 ? "" : "s"
        } promoting your products`}
        action={
          notRunning.length > 0 ? (
            <Button onClick={() => setLaunchOpen(true)}>
              <Rocket className="h-4 w-4" /> Launch program
            </Button>
          ) : undefined
        }
      />

      {/* Explainer banner (only meaningful once at least one program exists) */}
      {programs.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <p className="flex items-start gap-3 text-sm leading-relaxed">
            <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              Affiliates share a referral link and earn their commission on each buyer&apos;s{" "}
              <strong>first invoice</strong>. Commissions start pending and settle to paid when the billing engine
              runs.
            </span>
          </p>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate("creator", { creatorTab: "time" })}>
            <FastForward className="h-4 w-4" /> Open time machine
          </Button>
        </div>
      )}

      {/* Stats */}
      {programs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active programs" value={String(activePrograms)} sub={`${programs.length} total`} icon={Megaphone} />
          <StatCard label="Total affiliates" value={String(totalAffiliates)} sub="across all programs" icon={Handshake} />
          <StatCard
            label="Commissions paid"
            value={fmtMoney(totalPaid, { cents: true })}
            sub={`${fmtMoney(totalPending, { cents: true })} pending settlement`}
            icon={CircleDollarSign}
          />
          <StatCard
            label="Clicks driven"
            value={fmtCompact(totalClicks)}
            sub={`${totalConversions} conversion${totalConversions === 1 ? "" : "s"}`}
            icon={MousePointerClick}
          />
        </div>
      )}

      {/* Program cards */}
      {programs.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title={products.length === 0 ? "No products to promote yet" : "No affiliate programs yet"}
          description={
            products.length === 0
              ? "Create a product first — then launch an affiliate program and let your fans sell it for a cut of the first invoice."
              : "Let your biggest fans sell for you — affiliates share a referral link and earn a commission on every buyer they bring in."
          }
          action={
            products.length === 0 ? (
              <Button onClick={() => navigate("creator", { creatorTab: "products" })}>
                <Package className="h-4 w-4" /> Create a product
              </Button>
            ) : (
              <Button onClick={() => setLaunchOpen(true)}>
                <Rocket className="h-4 w-4" /> Launch your first affiliate program
              </Button>
            )
          }
        />
      ) : (
        <motion.div className="grid gap-5 md:grid-cols-2" variants={stagger} initial="hidden" animate="show">
          {programs.map((program) => {
            const programTiles: { label: string; value: string; emerald?: boolean }[] = [
              { label: "Affiliates", value: String(program.affiliateCount) },
              { label: "Clicks", value: fmtCompact(program.totalClicks) },
              { label: "Conv.", value: String(program.totalConversions) },
              { label: "Paid", value: fmtMoney(program.paidCents, { cents: true }), emerald: true },
              { label: "Pending", value: fmtMoney(program.pendingCents, { cents: true }) },
            ];
            return (
              <motion.div key={program.id} variants={fadeUp}>
                <Panel className={cn("flex h-full flex-col overflow-hidden", !program.active && "opacity-75")}>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <ProductCover
                          theme={program.product.coverTheme}
                          category="OTHER"
                          title={program.product.title}
                          className="h-12 w-16 shrink-0 rounded-lg"
                          iconClassName="h-10 w-10"
                        />
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold leading-tight">{program.product.title}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={program.product.status} />
                            {!program.active && (
                              <Badge
                                variant="outline"
                                className="border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                              >
                                Inactive
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-medium">
                        <Switch
                          checked={program.active}
                          onCheckedChange={(v) => {
                            // Pausing is disruptive → confirm first.
                            if (v) void toggleProgram(program, true);
                            else setConfirmPause(program);
                          }}
                          aria-label={`${program.active ? "Pause" : "Resume"} the ${program.product.title} program`}
                        />
                        {program.active ? "Active" : "Paused"}
                      </label>
                    </div>

                    <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        <BadgePercent className="h-3 w-3" />
                        {commissionLabel(program.commissionBps)} of first invoice
                      </span>
                      <span className="text-[11px] text-muted-foreground">Running since {fmtDate(program.createdAt)}</span>
                    </div>

                    <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {programTiles.map((s) => (
                        <div key={s.label} className="rounded-lg bg-muted/50 px-2 py-2 text-center">
                          <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {s.label}
                          </dt>
                          <dd
                            className={cn(
                              "mt-0.5 text-sm font-bold tabular-nums",
                              s.emerald && "text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            {s.value}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">Commission</span>
                      <Button variant="outline" size="sm" className="h-9" onClick={() => setManage(program)}>
                        <Percent className="h-4 w-4" /> Manage commission
                      </Button>
                    </div>
                  </div>

                  {/* Affiliate roster */}
                  <div className="mt-auto border-t bg-muted/30 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-semibold">
                        <Handshake className="h-3.5 w-3.5 text-primary" />
                        Affiliates{" "}
                        <span className="font-normal text-muted-foreground">({program.affiliateCount})</span>
                      </p>
                      <span className="text-[11px] text-muted-foreground">Sorted by earnings</span>
                    </div>
                    {program.affiliates.length === 0 ? (
                      <p className="rounded-xl border border-dashed bg-card p-3 text-center text-xs text-muted-foreground">
                        No affiliates yet — they&apos;ll appear here as soon as someone joins with a referral link.
                      </p>
                    ) : (
                      <div className={cn("max-h-56 overflow-auto rounded-xl border bg-card", SCROLL_THIN)}>
                        <table className="w-full min-w-[540px] text-xs">
                          <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="pl-3">Affiliate</TableHead>
                              <TableHead>Code</TableHead>
                              <TableHead className="text-right">Clicks</TableHead>
                              <TableHead className="text-right">Conv.</TableHead>
                              <TableHead className="text-right">Earned</TableHead>
                              <TableHead className="pr-3 text-right">Joined</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[...program.affiliates]
                              .sort((a, b) => b.earnedPaidCents - a.earnedPaidCents)
                              .map((a) => (
                                <TableRow key={a.id} className={cn(!a.active && "opacity-60")}>
                                  <TableCell className="py-2 pl-3">
                                    <div className="flex items-center gap-2">
                                      <UserAvatar
                                        name={a.affiliate.name || a.affiliate.email}
                                        color={a.affiliate.avatarColor}
                                        size="sm"
                                      />
                                      <div className="min-w-0">
                                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium leading-tight">
                                          <span className="truncate">{a.affiliate.name || a.affiliate.email}</span>
                                          {!a.active && (
                                            <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                                              Inactive
                                            </span>
                                          )}
                                        </p>
                                        <p className="truncate text-[11px] text-muted-foreground">{a.affiliate.email}</p>
                                      </div>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <span className="inline-flex items-center gap-0.5">
                                      <span className="font-mono text-[11px] font-semibold tracking-wide">{a.code}</span>
                                      <CopyButton value={referralLink(a.code, program.product.id)} />
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{a.clicks}</TableCell>
                                  <TableCell className="text-right tabular-nums">{a.conversions}</TableCell>
                                  <TableCell className="text-right">
                                    <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                                      {fmtMoney(a.earnedPaidCents, { cents: true })}
                                    </span>
                                    {a.earnedPendingCents > 0 && (
                                      <span className="block text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
                                        +{fmtMoney(a.earnedPendingCents, { cents: true })} pending
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell className="pr-3 text-right text-[11px] tabular-nums text-muted-foreground">
                                    {fmtDate(a.joinedAt)}
                                  </TableCell>
                                </TableRow>
                              ))}
                          </TableBody>
                        </table>
                      </div>
                    )}
                  </div>
                </Panel>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Products without a program */}
      {notRunning.length > 0 && (
        <section aria-label="Products without an affiliate program">
          <div className="mb-3">
            <h2 className="text-sm font-bold">Not running</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {notRunning.length} product{notRunning.length === 1 ? "" : "s"} without a program — set a commission and
              launch one.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {notRunning.map((p) => (
              <Panel key={p.id} className="flex flex-wrap items-center gap-3 p-4">
                <ProductCover
                  theme={p.coverTheme}
                  category={p.category}
                  title={p.title}
                  className="h-10 w-14 shrink-0 rounded-lg"
                  iconClassName="h-9 w-9"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold leading-tight">{p.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {categoryLabel(p.category)} · {fmtCompact(p.membersCount)} members
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="relative w-[72px]">
                    <Input
                      value={launchDrafts[p.id] ?? "25"}
                      onChange={(e) => setLaunchDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      inputMode="decimal"
                      aria-label={`Commission percent for ${p.title}`}
                      className="h-9 pr-6 text-right tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                  <Button
                    className="h-9"
                    onClick={() => void launchProgram(p, launchDrafts[p.id] ?? "25")}
                    disabled={launchingId === p.id}
                  >
                    {launchingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    Launch program
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        </section>
      )}

      <ManageCommissionDialog program={manage} onOpenChange={(o) => !o && setManage(null)} />
      <LaunchProgramDialog
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        products={notRunning}
        onLaunched={() => refresh()}
      />

      {/* Pause confirm */}
      <AlertDialog open={!!confirmPause} onOpenChange={(o) => !o && setConfirmPause(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause this affiliate program?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmPause?.product.title}&apos;s referral links will stop tracking clicks and new affiliates
              won&apos;t be able to join. Earned commissions are kept and still settle as normal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => {
                const program = confirmPause;
                setConfirmPause(null);
                if (program) void toggleProgram(program, false);
              }}
            >
              Pause program
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// Manage commission dialog (existing program)
// ============================================================================

function ManageCommissionDialog({
  program,
  onOpenChange,
}: {
  program: AffiliateProgramDTO | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const refresh = useAppStore((s) => s.refresh);
  const [percent, setPercent] = useState("30");
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (program) {
      setPercent(String(parseFloat((program.commissionBps / 100).toFixed(2))));
      setActive(program.active);
      setFormError(null);
      setBusy(false);
    }
  }, [program]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!program) return;
    const bps = percentToBps(percent);
    if (bps === null) return setFormError("Commission must be a percent between 1 and 90.");
    setFormError(null);
    setBusy(true);
    try {
      await api("/api/affiliates/programs", {
        json: { productId: program.product.id, commissionBps: bps, active },
      });
      toast({
        title: "Commission updated",
        description: active
          ? `Affiliates on ${program.product.title} now earn ${commissionLabel(bps)} of each first invoice.`
          : `Saved ${commissionLabel(bps)} — the program stays paused until you resume it.`,
      });
      refresh();
      onOpenChange(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!program} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage commission</DialogTitle>
          <DialogDescription>What affiliates earn for each buyer they bring to {program?.product.title}.</DialogDescription>
        </DialogHeader>
        <form id="manage-commission-form" onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="af-percent">Commission</Label>
            <div className="relative">
              <Input
                id="af-percent"
                type="number"
                min="1"
                max="90"
                step="0.5"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className="pr-8 text-base tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Affiliates earn this share of a referred buyer&apos;s first invoice — between 1% and 90%.
            </p>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Program active</span>
              <span className="block text-xs text-muted-foreground">
                Paused programs stop tracking referral clicks.
              </span>
            </span>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Program active" />
          </label>
          {formError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="manage-commission-form" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save commission
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Launch program dialog (pick a product + commission)
// ============================================================================

function LaunchProgramDialog({
  open,
  onOpenChange,
  products,
  onLaunched,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductCardDTO[];
  onLaunched: () => void;
}) {
  const { toast } = useToast();
  const [productId, setProductId] = useState("");
  const [percent, setPercent] = useState("25");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setProductId(products[0]?.id ?? "");
      setPercent("25");
      setFormError(null);
      setBusy(false);
    }
  }, [open, products]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!productId) return setFormError("Pick a product to launch the program on.");
    const bps = percentToBps(percent);
    if (bps === null) return setFormError("Commission must be a percent between 1 and 90.");
    setFormError(null);
    setBusy(true);
    try {
      await api("/api/affiliates/programs", { json: { productId, commissionBps: bps, active: true } });
      const title = products.find((p) => p.id === productId)?.title;
      toast({
        title: "Affiliate program launched",
        description: `Affiliates now earn ${commissionLabel(bps)} of the first invoice for ${title}.`,
      });
      onLaunched();
      onOpenChange(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Launch an affiliate program</DialogTitle>
          <DialogDescription>
            One program per product — affiliates who join get a referral link and earn a cut of the first invoice.
          </DialogDescription>
        </DialogHeader>
        <form id="launch-program-form" onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger aria-label="Product to launch the program on" className="w-full">
                <SelectValue placeholder="Pick a product" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="launch-percent">Commission</Label>
            <div className="relative">
              <Input
                id="launch-percent"
                type="number"
                min="1"
                max="90"
                step="0.5"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                className="pr-8 text-base tabular-nums"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                %
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              25% is a strong default — between 1% and 90%. You can change it anytime.
            </p>
          </div>
          {formError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="launch-program-form" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Launch program
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB: GIVEAWAYS (prize drops — free entries, auto-drawn winners)
// ============================================================================

/**
 * The creator endpoint also returns totalEntriesWeighted (sum of every
 * entrant's entry count); the shared DTO type predates it, so extend locally.
 */
type CreatorGiveawayRow = GiveawayCreatorDTO & { totalEntriesWeighted: number };

/** "Ends in 5d 12h" style countdown label for a LIVE drop. */
function endsInLabel(endsAt: string, nowMs: number): string {
  const diff = new Date(endsAt).getTime() - nowMs;
  if (diff <= 0) return "Closing soon";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days >= 1) return `Ends in ${days}d ${hours}h`;
  if (hours >= 1) return `Ends in ${hours}h ${mins}m`;
  return `Ends in ${mins}m`;
}

/**
 * Ticks every 30s so LIVE countdowns stay fresh. Anchored to the simulated
 * clock whenever it runs ahead of real time (the sim world is the truth for
 * end dates); the time-machine refresh bumps the store nonce, which refetches
 * this tab's data anyway.
 */
function useNowMs(): number {
  const simNow = useSimNow();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return useMemo(() => Math.max(Date.now(), new Date(simNow).getTime()), [tick, simNow]);
}

function GiveawaysTab({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const refresh = useAppStore((s) => s.refresh);
  const navigate = useAppStore((s) => s.navigate);
  const nowMs = useNowMs();

  // Giveaways feed + the creator's own products (feeds the create dialog's
  // product select — same catalog call the products tab uses).
  const { data, error, loading } = useCreatorFetch(async () => {
    const [giveawaysRes, productsRes] = await Promise.all([
      api<{ giveaways: CreatorGiveawayRow[] }>("/api/giveaways/creator"),
      api<{ products: ProductCardDTO[] }>(`/api/products?creatorId=${user.id}`),
    ]);
    return { giveaways: giveawaysRes.giveaways, products: productsRes.products };
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDraw, setConfirmDraw] = useState<CreatorGiveawayRow | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<CreatorGiveawayRow | null>(null);
  const [drawingId, setDrawingId] = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  // LIVE drops first (ending soonest), then recently ended — mirrors the
  // public feed's ordering.
  const sorted = useMemo(() => {
    const live = (data?.giveaways ?? []).filter((g) => g.status === "LIVE").sort((a, b) => a.endsAt.localeCompare(b.endsAt));
    const ended = (data?.giveaways ?? [])
      .filter((g) => g.status !== "LIVE")
      .sort((a, b) => (b.drawnAt ?? b.endsAt).localeCompare(a.drawnAt ?? a.endsAt));
    return [...live, ...ended];
  }, [data]);

  async function drawWinners(g: CreatorGiveawayRow) {
    setDrawingId(g.id);
    try {
      const res = await api<{ ok: boolean; winners: { userId: string; name: string | null; email: string }[]; entryCount: number }>(
        `/api/giveaways/${g.id}/draw`,
        { json: {} }
      );
      const names = res.winners.map((w) => w.name || w.email).join(", ");
      toast({
        title: "Winners drawn",
        description: `${names ? `${names} won ${g.title} — ` : ""}${g.title} closed · ${res.entryCount} entrant${
          res.entryCount === 1 ? "" : "s"
        } were notified.`,
      });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't draw winners", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDrawingId(null);
    }
  }

  async function cancelDrop(g: CreatorGiveawayRow) {
    setCancelingId(g.id);
    try {
      await api(`/api/giveaways/${g.id}`, { method: "PATCH", json: { cancel: true } });
      toast({
        title: "Drop canceled",
        description: `${g.title} ended without drawing winners. Entries stay on record.`,
      });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't cancel the drop", description: (e as Error).message, variant: "destructive" });
    } finally {
      setCancelingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading giveaways">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[26rem] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) return <LoadError message={error || "Giveaways unavailable."} />;

  const { giveaways, products } = data;
  const liveCount = giveaways.filter((g) => g.status === "LIVE").length;
  const totalEntries = giveaways.reduce((s, g) => s + g.entryCount, 0);
  const totalWeighted = giveaways.reduce((s, g) => s + g.totalEntriesWeighted, 0);
  const winnersCrowned = giveaways.reduce((s, g) => s + g.winners.length, 0);
  const endedCount = giveaways.length - liveCount;
  // recentEntries is capped at 8 rows — only trust the 7-day window when no
  // drop's roster was truncated; otherwise fall back to an average.
  const canComputeWeek = giveaways.every((g) => g.recentEntries.length >= g.entryCount);
  const weekAgoMs = nowMs - 7 * 86400000;
  const entriesThisWeek = canComputeWeek
    ? giveaways.reduce(
        (s, g) =>
          s + g.recentEntries.filter((r) => new Date(r.createdAt).getTime() >= weekAgoMs).reduce((s2, r) => s2 + r.entries, 0),
        0
      )
    : null;
  const avgEntries = giveaways.length > 0 ? totalWeighted / giveaways.length : 0;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Giveaways"
        description="Run prize drops to grow your audience — entries are free, winners drawn automatically."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New giveaway
          </Button>
        }
      />

      {/* Live-drop explainer + time-machine shortcut */}
      {liveCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <p className="flex items-start gap-3 text-sm leading-relaxed">
            <Gift className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>
              Entries are free and winners are drawn automatically when the countdown hits zero —{" "}
              <strong>advance the clock to watch a drop auto-close and notify winners</strong>. Members of the linked
              product earn bonus entries.
            </span>
          </p>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => navigate("creator", { creatorTab: "time" })}>
            <FastForward className="h-4 w-4" /> Open time machine
          </Button>
        </div>
      )}

      {/* Stats */}
      {giveaways.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Live drops" value={String(liveCount)} sub={`${giveaways.length} total`} icon={Zap} />
          <StatCard
            label="Total entries"
            value={fmtCompact(totalEntries)}
            sub={`${totalWeighted} incl. member bonuses`}
            icon={Users}
          />
          <StatCard
            label="Winners crowned"
            value={String(winnersCrowned)}
            sub={`${endedCount} drop${endedCount === 1 ? "" : "s"} ended`}
            icon={Trophy}
          />
          {entriesThisWeek !== null ? (
            <StatCard label="Entries this week" value={String(entriesThisWeek)} sub="last 7 days" icon={TrendingUp} />
          ) : (
            <StatCard
              label="Avg entries / drop"
              value={avgEntries % 1 === 0 ? String(avgEntries) : avgEntries.toFixed(1)}
              sub="entries incl. member bonuses"
              icon={TrendingUp}
            />
          )}
        </div>
      )}

      {/* Drop cards */}
      {giveaways.length === 0 ? (
        <EmptyState
          icon={Gift}
          title="Run your first giveaway"
          description="Free-to-enter prize drops turn visitors into followers — and members of your products earn bonus entries, so every drop rewards your existing subscribers too."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New giveaway
            </Button>
          }
        />
      ) : (
        <motion.div className="grid gap-5 sm:grid-cols-2" variants={stagger} initial="hidden" animate="show">
          {sorted.map((g) => (
            <motion.div key={g.id} variants={fadeUp}>
              <GiveawayCard
                g={g}
                nowMs={nowMs}
                drawing={drawingId === g.id}
                canceling={cancelingId === g.id}
                onDraw={setConfirmDraw}
                onCancel={setConfirmCancel}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      <CreateGiveawayDialog open={createOpen} onOpenChange={setCreateOpen} products={products} onCreated={() => refresh()} />

      {/* Draw winners confirm */}
      <AlertDialog open={!!confirmDraw} onOpenChange={(o) => !o && setConfirmDraw(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Draw winners now?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends the drop and notifies winners immediately. {confirmDraw?.winnerCount} winner
              {confirmDraw?.winnerCount === 1 ? "" : "s"} will be drawn from {confirmDraw?.entryCount} entrant
              {confirmDraw?.entryCount === 1 ? "" : "s"} of “{confirmDraw?.title}” — entries are weighted, so more
              entries mean better odds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const g = confirmDraw;
                setConfirmDraw(null);
                if (g) void drawWinners(g);
              }}
            >
              <Trophy className="h-4 w-4" /> Draw winners
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel drop confirm */}
      <AlertDialog open={!!confirmCancel} onOpenChange={(o) => !o && setConfirmCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this drop?</AlertDialogTitle>
            <AlertDialogDescription>
              Ends the drop without drawing winners. “{confirmCancel?.title}” closes immediately and its{" "}
              {confirmCancel?.entryCount} entrant{confirmCancel?.entryCount === 1 ? "" : "s"} keep their entries on
              record — nobody wins the prize.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it running</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                const g = confirmCancel;
                setConfirmCancel(null);
                if (g) void cancelDrop(g);
              }}
            >
              Cancel drop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One giveaway card — LIVE drops show countdown + draw/cancel actions, ENDED ones the winners roster. */
function GiveawayCard({
  g,
  nowMs,
  drawing,
  canceling,
  onDraw,
  onCancel,
}: {
  g: CreatorGiveawayRow;
  nowMs: number;
  drawing: boolean;
  canceling: boolean;
  onDraw: (g: CreatorGiveawayRow) => void;
  onCancel: (g: CreatorGiveawayRow) => void;
}) {
  const live = g.status === "LIVE";
  // Sim-clock aware "now" for relative timestamps ("Drawn 5d ago") — fresher
  // than the bootstrap snapshot the store carries.
  const anchor = new Date(nowMs).toISOString();
  const endedLabel = g.winners.length > 0 ? "Drawn" : "Ended";

  return (
    <Panel className="flex h-full flex-col overflow-hidden transition-shadow hover:shadow-md">
      {/* Themed banner + status */}
      <div className="relative">
        <ProductCover
          theme={g.coverTheme}
          category="OTHER"
          title={g.title}
          className="h-24 sm:h-28"
          iconClassName="h-20 w-20 sm:h-24 sm:w-24"
        />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600/95 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden />
              Live
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-border bg-card/95 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground shadow-sm">
              Ended
            </span>
          )}
          {live ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-emerald-700 shadow-sm dark:text-emerald-400">
              <Timer className="h-3.5 w-3.5" aria-hidden />
              {endsInLabel(g.endsAt, nowMs)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground shadow-sm">
              <Trophy className="h-3.5 w-3.5" aria-hidden />
              {endedLabel} {relTime(g.drawnAt ?? g.endsAt, anchor)}
            </span>
          )}
        </div>
        {g.prizeValueCents > 0 && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-card/95 px-2.5 py-1 text-[11px] font-bold tabular-nums shadow-sm">
            <Gift className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            {fmtMoney(g.prizeValueCents)} prize value
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-semibold leading-tight">{g.title}</h3>
        <p className="mt-1.5 flex items-start gap-2 text-sm leading-snug">
          <Gift className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <span className="min-w-0 font-medium">{g.prize}</span>
        </p>
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{g.description}</p>

        {/* Linked product */}
        <div className="mt-3 flex min-h-[2.5rem] items-center gap-2.5">
          {g.product ? (
            <>
              <ProductCover
                theme={g.product.coverTheme}
                category={g.product.category}
                title={g.product.title}
                className="h-10 w-14 shrink-0 rounded-lg"
                iconClassName="h-9 w-9"
              />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold leading-tight">{g.product.title}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {categoryLabel(g.product.category)} · members earn +{g.memberBonus} entries
                </p>
              </div>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Package className="h-4 w-4 shrink-0" aria-hidden /> No product linked — standalone drop
            </p>
          )}
        </div>

        {/* Performance mini-grid */}
        <dl className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted/50 px-2 py-2 text-center">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Entries</dt>
            <dd className="mt-0.5 text-sm font-bold tabular-nums">{g.entryCount}</dd>
          </div>
          <div className="rounded-lg bg-muted/50 px-2 py-2 text-center">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Winners</dt>
            <dd className="mt-0.5 text-sm font-bold tabular-nums">{live ? g.winnerCount : g.winners.length}</dd>
          </div>
          <div className="rounded-lg bg-muted/50 px-2 py-2 text-center">
            <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Member bonus</dt>
            <dd className="mt-0.5 text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              +{g.memberBonus}
            </dd>
          </div>
        </dl>

        {/* Recent entries */}
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <UserPlus className="h-3.5 w-3.5 text-primary" aria-hidden />
            Recent entries <span className="font-normal text-muted-foreground">({g.entryCount})</span>
          </p>
          {g.recentEntries.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">
              No entries yet — they&apos;ll pile up here as visitors join the drop.
            </p>
          ) : (
            <ul className={cn("mt-2 max-h-48 space-y-1 overflow-y-auto pr-1", SCROLL_THIN)} aria-label={`Recent entries for ${g.title}`}>
              {g.recentEntries.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-2.5 py-1.5">
                  <UserAvatar name={r.entrant.name || r.entrant.email} color={r.entrant.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
                      <span className="truncate">{r.entrant.name || r.entrant.email}</span>
                      {r.won && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          <Trophy className="h-3 w-3" aria-hidden /> Won
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{relTime(r.createdAt, anchor)}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                      r.entries > 1
                        ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    ×{r.entries}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer: actions while LIVE, winners roster once ENDED */}
        {live ? (
          <div className="mt-auto border-t bg-muted/30 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button className="min-h-11 flex-1 sm:flex-none" disabled={drawing || canceling} onClick={() => onDraw(g)}>
                {drawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}
                Draw winners now
              </Button>
              <Button
                variant="ghost"
                className="min-h-11 text-muted-foreground hover:bg-red-500/10 hover:text-red-600"
                disabled={drawing || canceling}
                onClick={() => onCancel(g)}
              >
                {canceling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                Cancel drop
              </Button>
            </div>
            <p className="mt-2.5 text-[11px] text-muted-foreground">
              Ends {fmtDate(g.endsAt)} · winners are drawn automatically at the deadline
            </p>
          </div>
        ) : (
          <div className="mt-auto border-t bg-muted/30 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Trophy className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              Winners <span className="font-normal text-muted-foreground">(of {g.entryCount} entrants)</span>
            </p>
            {g.winners.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed bg-card p-2.5 text-center text-xs text-muted-foreground">
                No winners drawn — this drop was canceled.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {g.winners.map((w) => (
                  <li key={w.id} className="flex items-center gap-2.5 rounded-lg bg-card px-2.5 py-1.5">
                    <UserAvatar name={w.entrant.name || w.entrant.email} color={w.entrant.avatarColor} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 text-[13px] font-medium leading-tight">
                        <span className="truncate">{w.entrant.name || w.entrant.email}</span>
                        <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          <Trophy className="h-3 w-3" aria-hidden /> Won
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        entered with {w.entries} {w.entries === 1 ? "entry" : "entries"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ============================================================================
// Create giveaway dialog (launch a drop)
// ============================================================================

const GIVEAWAY_END_OPTIONS = [1, 2, 3, 5, 7, 14, 30];

function CreateGiveawayDialog({
  open,
  onOpenChange,
  products,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductCardDTO[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prize, setPrize] = useState("");
  const [prizeValue, setPrizeValue] = useState("");
  const [productId, setProductId] = useState("none");
  const [endsInDays, setEndsInDays] = useState("7");
  const [winnerCount, setWinnerCount] = useState("1");
  const [memberBonus, setMemberBonus] = useState("2");
  const [coverTheme, setCoverTheme] = useState<string>("emerald");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setTitle("");
      setDescription("");
      setPrize("");
      setPrizeValue("");
      setProductId("none");
      setEndsInDays("7");
      setWinnerCount("1");
      setMemberBonus("2");
      setCoverTheme("emerald");
      setFormError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (t.length < 3 || t.length > 80) return setFormError("Title must be 3–80 characters.");
    const d = description.trim();
    if (d.length < 10 || d.length > 600) return setFormError("Description must be 10–600 characters.");
    const p = prize.trim();
    if (p.length < 3 || p.length > 200) return setFormError("Prize must be 3–200 characters.");
    let prizeValueCents: number | undefined;
    if (prizeValue.trim() !== "") {
      const v = Number(prizeValue);
      if (!Number.isFinite(v) || v < 0) return setFormError("Prize value must be a dollar amount.");
      if (v > 100_000) return setFormError("Prize value must be $100,000 or less.");
      prizeValueCents = Math.round(v * 100);
    }
    setFormError(null);
    setBusy(true);
    try {
      await api("/api/giveaways", {
        json: {
          title: t,
          description: d,
          prize: p,
          ...(prizeValueCents !== undefined ? { prizeValueCents } : {}),
          ...(productId !== "none" ? { productId } : {}),
          endsInDays: Number(endsInDays),
          winnerCount: Number(winnerCount),
          memberBonus: Number(memberBonus),
          coverTheme,
        },
      });
      const days = Number(endsInDays);
      toast({
        title: "Giveaway is live!",
        description: `${t} is accepting free entries for the next ${days} ${days === 1 ? "day" : "days"}.`,
      });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Launch a giveaway</DialogTitle>
          <DialogDescription>
            Free-to-enter prize drop with automatic winner draw. Drops convert visitors into members — bonus entries
            reward your existing subscribers.
          </DialogDescription>
        </DialogHeader>
        <form id="create-giveaway-form" onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ga-title">Title</Label>
            <Input
              id="ga-title"
              value={title}
              maxLength={80}
              onChange={(e) => {
                setTitle(e.target.value);
                setFormError(null);
              }}
              placeholder="e.g. 1-Year Elite Membership Giveaway"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ga-description">Description</Label>
            <Textarea
              id="ga-description"
              value={description}
              rows={3}
              maxLength={600}
              onChange={(e) => {
                setDescription(e.target.value);
                setFormError(null);
              }}
              placeholder="What's the drop, who can enter and what do winners get?"
            />
            <p className="text-[11px] text-muted-foreground">10–600 characters.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
            <div className="space-y-1.5">
              <Label htmlFor="ga-prize">Prize</Label>
              <Input
                id="ga-prize"
                value={prize}
                maxLength={200}
                onChange={(e) => {
                  setPrize(e.target.value);
                  setFormError(null);
                }}
                placeholder="e.g. Ledger Nano X hardware wallet"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ga-value">Value ($)</Label>
              <div className="relative">
                <Input
                  id="ga-value"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={prizeValue}
                  onChange={(e) => {
                    setPrizeValue(e.target.value);
                    setFormError(null);
                  }}
                  className="pl-7 text-base tabular-nums"
                  aria-label="Prize value in dollars (optional)"
                />
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Linked product</Label>
            <Select
              value={productId}
              onValueChange={(v) => {
                setProductId(v);
                setFormError(null);
              }}
            >
              <SelectTrigger aria-label="Product to promote with this drop" className="w-full">
                <SelectValue placeholder="Pick a product" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No product (standalone drop)</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Active members of the linked product automatically earn the bonus entries. Only your own products are
              listed.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Ends in</Label>
              <Select
                value={endsInDays}
                onValueChange={(v) => {
                  setEndsInDays(v);
                  setFormError(null);
                }}
              >
                <SelectTrigger aria-label="Days until the drop ends" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GIVEAWAY_END_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} {d === 1 ? "day" : "days"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Winners</Label>
              <Select
                value={winnerCount}
                onValueChange={(v) => {
                  setWinnerCount(v);
                  setFormError(null);
                }}
              >
                <SelectTrigger aria-label="Number of winners to draw" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Member bonus</Label>
              <Select
                value={memberBonus}
                onValueChange={(v) => {
                  setMemberBonus(v);
                  setFormError(null);
                }}
              >
                <SelectTrigger aria-label="Bonus entries for members of the linked product" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      +{n} {n === 1 ? "entry" : "entries"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Cover theme</Label>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Cover theme">
              {COVER_THEMES.map((theme) => {
                const selected = coverTheme === theme;
                return (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => {
                      setCoverTheme(theme);
                      setFormError(null);
                    }}
                    aria-label={`${theme} cover theme`}
                    aria-pressed={selected}
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      COVER_GRADIENTS[theme] ?? COVER_GRADIENTS.emerald,
                      selected ? "scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background" : "hover:scale-105"
                    )}
                  >
                    {selected && <Check className="h-4 w-4 text-white drop-shadow-sm" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
          {formError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-giveaway-form" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Launch giveaway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB: QUESTIONS — product Q&A inbox (Task 12-c)
// ============================================================================

/** Tone-tinted stat card — mirrors the shared StatCard markup with colored icon chips. */
const QA_STAT_TONES: Record<string, string> = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  teal: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cyan: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
};

function QaStatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone: keyof typeof QA_STAT_TONES;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", QA_STAT_TONES[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

type QuestionStatusFilter = "ALL" | "OPEN" | "ANSWERED";

function QuestionsTab({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const navigate = useAppStore((s) => s.navigate);
  // Ticking anchor (max(real now, sim clock)) so freshly posted answers read
  // "just now" instead of "in 1m" against the stale bootstrap snapshot.
  const nowMs = useNowMs();
  const now = useMemo(() => new Date(nowMs).toISOString(), [nowMs]);

  // One round trip — the inbox and its global stats (server order: OPEN first,
  // then upvotes desc, then newest).
  const { data, error, loading, setData } = useCreatorFetch(() =>
    api<{ questions: CreatorQuestionDTO[]; stats: QuestionsStatsDTO }>("/api/creator/questions")
  );

  const [statusFilter, setStatusFilter] = useState<QuestionStatusFilter>("ALL");
  const [productFilter, setProductFilter] = useState("ALL");

  // Distinct products for the filter select, in inbox order.
  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const q of data?.questions ?? []) if (!seen.has(q.product.id)) seen.set(q.product.id, q.product.title);
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }, [data]);

  // Status counts honor the product filter; the list honors both filters.
  const byProduct = useMemo(
    () => (data?.questions ?? []).filter((q) => productFilter === "ALL" || q.product.id === productFilter),
    [data, productFilter]
  );
  const filtered = useMemo(
    () => byProduct.filter((q) => statusFilter === "ALL" || q.status === statusFilter),
    [byProduct, statusFilter]
  );

  function resetFilters() {
    setStatusFilter("ALL");
    setProductFilter("ALL");
  }

  /**
   * Optimistic answer: append locally as the creator, flip OPEN→ANSWERED and
   * move the stat counters; revert the snapshot + destructive toast on error.
   */
  async function postAnswer(q: CreatorQuestionDTO, body: string): Promise<boolean> {
    const wasOpen = q.status === "OPEN";
    const optimistic: AnswerDTO = {
      id: `tmp-${q.id}-${Date.now()}`,
      body,
      isCreator: true,
      createdAt: new Date().toISOString(),
      author: { id: user.id, name: user.name || user.email, avatarColor: user.avatarColor },
    };
    const snapshot = data;
    setData((prev) =>
      prev
        ? {
            questions: prev.questions.map((qq) =>
              qq.id === q.id
                ? {
                    ...qq,
                    status: wasOpen ? ("ANSWERED" as const) : qq.status,
                    answers: [...qq.answers, optimistic],
                    answerCount: qq.answerCount + 1,
                  }
                : qq
            ),
            stats: wasOpen
              ? { ...prev.stats, open: Math.max(0, prev.stats.open - 1), answered: prev.stats.answered + 1 }
              : prev.stats,
          }
        : prev
    );
    try {
      const res = await api<{ answer: AnswerDTO; question: { id: string; status: "OPEN" | "ANSWERED" } }>(
        `/api/questions/${q.id}/answers`,
        { json: { body } }
      );
      // Swap the temp row for the server's canonical one (real id + timestamp).
      setData((prev) =>
        prev
          ? {
              ...prev,
              questions: prev.questions.map((qq) =>
                qq.id === q.id ? { ...qq, answers: qq.answers.map((a) => (a.id === optimistic.id ? res.answer : a)) } : qq
              ),
            }
          : prev
      );
      toast({ title: "Answer posted", description: "The buyer will be notified." });
      return true;
    } catch (e) {
      setData(snapshot);
      toast({ title: "Couldn't post the answer", description: (e as Error).message, variant: "destructive" });
      return false;
    }
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading Q&A inbox">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <div className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) return <LoadError message={error || "Q&A inbox unavailable."} />;

  const { questions, stats } = data;
  const openInProduct = byProduct.filter((q) => q.status === "OPEN").length;
  const answeredInProduct = byProduct.length - openInProduct;

  return (
    <div className="space-y-5">
      <SectionHeader title="Q&A inbox" description="Answer buyer questions — fast replies sell more memberships." />

      {questions.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inbox zero"
          description="No questions yet — they&apos;ll land here the moment a buyer asks on your product pages."
        />
      ) : (
        <>
          {/* Stats */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <QaStatCard label="Open" value={String(stats.open)} sub="awaiting your reply" icon={CircleHelp} tone="emerald" />
            <QaStatCard
              label="Answered"
              value={String(stats.answered)}
              sub={`${questions.length} total`}
              icon={BadgeCheck}
              tone="teal"
            />
            <QaStatCard
              label="Total upvotes"
              value={String(stats.totalUpvotes)}
              sub="across all questions"
              icon={ChevronUp}
              tone="amber"
            />
            <QaStatCard
              label="Avg response"
              value={stats.avgResponseHours === null ? "—" : `${stats.avgResponseHours.toFixed(1)}h`}
              sub="question → first reply"
              icon={Clock}
              tone="cyan"
            />
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5 rounded-full border bg-card p-1" role="group" aria-label="Filter by status">
              {(["ALL", "OPEN", "ANSWERED"] as const).map((s) => {
                const count = s === "ALL" ? byProduct.length : s === "OPEN" ? openInProduct : answeredInProduct;
                return (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    aria-pressed={statusFilter === s}
                    className={cn(
                      "h-10 rounded-full px-3.5 text-xs font-semibold transition-colors",
                      statusFilter === s
                        ? s === "OPEN"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : s === "ANSWERED"
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {s === "ALL" ? `All (${count})` : s === "OPEN" ? `Open (${count})` : `Answered (${count})`}
                  </button>
                );
              })}
            </div>
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="h-10 w-full sm:w-[220px]" aria-label="Filter by product">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All products</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Question cards */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No questions match this filter"
              description="Try a different status or product."
              action={
                <Button variant="ghost" onClick={resetFilters}>
                  <RotateCcw className="h-4 w-4" /> Reset filters
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3">
              {filtered.map((q, i) => (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.05, 0.4), duration: 0.28, ease: "easeOut" }}
                >
                  <QuestionCard
                    q={q}
                    now={now}
                    onAnswer={postAnswer}
                    onOpenProduct={(productId) => navigate("product", { productId })}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One question card — product chip, status + upvotes, collapsible answer thread, inline composer. */
function QuestionCard({
  q,
  now,
  onAnswer,
  onOpenProduct,
}: {
  q: CreatorQuestionDTO;
  now: string;
  onAnswer: (q: CreatorQuestionDTO, body: string) => Promise<boolean>;
  onOpenProduct: (productId: string) => void;
}) {
  // The composer stays expanded on OPEN questions (an inbox — friction kills
  // replies); on answered ones it hides behind the "Add another reply" toggle.
  const [composerOpen, setComposerOpen] = useState(q.status === "OPEN");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const answered = q.status === "ANSWERED";

  async function submit() {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    const ok = await onAnswer(q, body);
    setPosting(false);
    if (ok) {
      setDraft("");
      setExpanded(true); // reveal the freshly posted reply in the thread
      setComposerOpen(false); // the question is answered now — collapse behind the toggle
    }
  }

  return (
    <Panel className="p-4 sm:p-5">
      {/* Product chip + status / upvotes */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProductCover
            theme={q.product.coverTheme}
            category="OTHER"
            title={q.product.title}
            className="h-10 w-14 shrink-0 rounded-lg"
            iconClassName="h-9 w-9"
          />
          <button
            onClick={() => onOpenProduct(q.product.id)}
            className="flex min-h-10 min-w-0 items-center gap-1 rounded-lg text-left text-sm font-semibold transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${q.product.title} in the marketplace`}
          >
            <span className="truncate">{q.product.title}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {answered ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/12 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Answered
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden /> Awaiting reply
            </span>
          )}
          <span
            className="inline-flex items-center gap-0.5 rounded-full border bg-card px-2.5 py-1 text-[11px] font-semibold tabular-nums"
            aria-label={`${q.upvotes} ${q.upvotes === 1 ? "upvote" : "upvotes"}`}
          >
            <ChevronUp className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            {q.upvotes}
          </span>
        </div>
      </div>

      {/* Question body + author */}
      <p className="mt-3 text-sm font-medium leading-relaxed">{q.body}</p>
      <div className="mt-2.5 flex items-center gap-2">
        <UserAvatar name={q.author.name} color={q.author.avatarColor} size="sm" />
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{q.author.name}</span> · asked {relTime(q.createdAt, now)}
        </p>
      </div>

      {/* Existing answers — collapsed behind a toggle */}
      {q.answers.length > 0 && (
        <div className="mt-1.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={`${q.id}-answers`}
            className="flex min-h-10 w-full items-center gap-1.5 rounded-lg px-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5 text-primary" aria-hidden />
            {q.answerCount} answer{q.answerCount === 1 ? "" : "s"}
            <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
          {expanded && (
            <div id={`${q.id}-answers`} className="mt-1 space-y-2 border-l-2 pl-4">
              {q.answers.map((a) => (
                <div
                  key={a.id}
                  className={cn("rounded-r-lg px-3 py-2.5", a.isCreator ? "border-l-2 border-emerald-400/60 bg-emerald-500/[0.04]" : "bg-muted/40")}
                >
                  <div className="flex items-center gap-2">
                    <UserAvatar name={a.author.name} color={a.author.avatarColor} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium leading-tight">
                        <span className="truncate">{a.author.name}</span>
                        {a.isCreator && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-emerald-400/60 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <BadgeCheck className="h-3 w-3" aria-hidden /> Creator
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{relTime(a.createdAt, now)}</p>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-relaxed">{a.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inline composer — always visible on OPEN questions */}
      {composerOpen ? (
        <div className="mt-3 border-t pt-3">
          <Textarea
            rows={3}
            maxLength={1000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Reply as the creator…"
            aria-label={`Reply to ${q.author.name} on ${q.product.title}`}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button className="h-11" disabled={!draft.trim() || posting} onClick={() => void submit()}>
              {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Post answer
            </Button>
            {answered && !posting && (
              <Button
                variant="ghost"
                className="h-11"
                onClick={() => {
                  setComposerOpen(false);
                  setDraft("");
                }}
              >
                Cancel
              </Button>
            )}
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{draft.length}/1000</span>
          </div>
        </div>
      ) : (
        <div className="mt-3 border-t pt-3">
          <Button variant="ghost" className="min-h-10 text-muted-foreground" onClick={() => setComposerOpen(true)}>
            <Plus className="h-4 w-4" /> Add another reply
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ============================================================================
// TAB: WEBHOOKS (event-driven access console)
// ============================================================================

const ENDPOINT_PROVIDERS: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  DISCORD_BOT: {
    label: "Discord bot",
    icon: Send,
    cls: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25",
  },
  TELEGRAM_BOT: {
    label: "Telegram bot",
    icon: Send,
    cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25",
  },
  GENERIC: { label: "Generic", icon: Webhook, cls: "bg-muted text-muted-foreground border-border" },
};

function WebhooksTab() {
  const { toast } = useToast();
  const fallbackNow = useSimNow();
  const refresh = useAppStore((s) => s.refresh);

  const { data, error, loading, setData } = useCreatorFetch(async () => {
    const [epsRes, delsRes] = await Promise.all([
      api<{ endpoints: WebhookEndpointDTO[] }>("/api/webhooks/endpoints"),
      api<{ deliveries: WebhookDeliveryDTO[]; now: string }>("/api/webhooks/deliveries"),
    ]);
    return { endpoints: epsRes.endpoints, deliveries: delsRes.deliveries, now: delsRes.now };
  });
  // Compare delivery timestamps against the server's clock at fetch time —
  // the store clock snapshot goes stale the moment new deliveries land.
  const now = data?.now ?? fallbackNow;

  const [addOpen, setAddOpen] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [endpointFilter, setEndpointFilter] = useState("ALL");
  const [selectedDelivery, setSelectedDelivery] = useState<WebhookDeliveryDTO | null>(null);

  async function toggleActive(ep: WebhookEndpointDTO, next: boolean) {
    // Optimistic flip; revert on failure.
    setData((prev) =>
      prev
        ? { ...prev, endpoints: prev.endpoints.map((e) => (e.id === ep.id ? { ...e, isActive: next } : e)) }
        : prev
    );
    try {
      await api(`/api/webhooks/endpoints/${ep.id}`, { method: "PATCH", json: { isActive: next } });
      toast({
        title: next ? "Endpoint activated" : "Endpoint paused",
        description: next ? `${ep.name} will receive events again.` : `${ep.name} no longer receives events.`,
      });
      refresh();
    } catch (e) {
      setData((prev) =>
        prev
          ? { ...prev, endpoints: prev.endpoints.map((x) => (x.id === ep.id ? { ...x, isActive: !next } : x)) }
          : prev
      );
      toast({ title: "Couldn't update the endpoint", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function deleteEndpoint(ep: WebhookEndpointDTO) {
    try {
      await api(`/api/webhooks/endpoints/${ep.id}`, { method: "DELETE" });
      toast({ title: "Endpoint deleted", description: `${ep.name} and its delivery history were removed.` });
      refresh();
    } catch (e) {
      toast({ title: "Couldn't delete the endpoint", description: (e as Error).message, variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading webhooks">
        <Skeleton className="h-16 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-52 rounded-2xl" />
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (error || !data) return <LoadError message={error || "Webhooks unavailable."} />;

  const { endpoints, deliveries } = data;
  const filteredDeliveries = deliveries.filter(
    (d) =>
      (statusFilter === "ALL" || d.status === statusFilter) &&
      (endpointFilter === "ALL" || d.endpoint.id === endpointFilter)
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Webhooks"
        description="Event-driven access management for your products"
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add endpoint
          </Button>
        }
      />

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-teal-500/30 bg-teal-500/10 p-4">
        <Zap className="mt-0.5 h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" />
        <p className="text-sm leading-relaxed">
          Every subscription event fans out to your endpoints with <strong>HMAC-SHA256 signatures</strong>. Discord and
          Telegram bot endpoints automate role assignment the moment access is granted or revoked.
        </p>
      </div>

      {/* Endpoints */}
      <section aria-label="Endpoints">
        <h2 className="mb-3 text-sm font-bold">
          Endpoints <span className="ml-1 font-normal text-muted-foreground">({endpoints.length})</span>
        </h2>
        {endpoints.length === 0 ? (
          <EmptyState
            icon={Webhook}
            title="No endpoints yet"
            description="Register a Discord bot, Telegram bot or generic HTTPS endpoint to automate access and sync your CRM."
            action={
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" /> Add your first endpoint
              </Button>
            }
          />
        ) : (
          <motion.div
            className="grid gap-4 lg:grid-cols-2"
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {endpoints.map((ep) => {
              const provider = ENDPOINT_PROVIDERS[ep.provider] || ENDPOINT_PROVIDERS.GENERIC;
              const ProviderIcon = provider.icon;
              const isRevealed = revealed.has(ep.id);
              return (
                <motion.div key={ep.id} variants={fadeUp}>
                  <Panel className={cn("flex h-full flex-col p-5", !ep.isActive && "opacity-70")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            provider.cls
                          )}
                        >
                          <ProviderIcon className="h-3 w-3" />
                          {provider.label}
                        </span>
                        <h3 className="min-w-0 truncate font-semibold">{ep.name}</h3>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-600"
                            aria-label={`Delete ${ep.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this endpoint?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {ep.name} will stop receiving events and its {ep.deliveryCount} delivery
                              {ep.deliveryCount === 1 ? "" : " records"} will be permanently removed.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Keep endpoint</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-red-600 text-white hover:bg-red-700"
                              onClick={() => void deleteEndpoint(ep)}
                            >
                              Delete endpoint
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>

                    <div className="mt-3.5 space-y-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-20 shrink-0 font-medium text-muted-foreground">URL</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={ep.url}>
                          {ep.url}
                        </span>
                        <CopyButton value={ep.url} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="w-20 shrink-0 font-medium text-muted-foreground">Secret</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                          {isRevealed ? ep.secret : "•".repeat(30)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setRevealed((prev) => {
                              const next = new Set(prev);
                              if (next.has(ep.id)) next.delete(ep.id);
                              else next.add(ep.id);
                              return next;
                            })
                          }
                          aria-label={isRevealed ? "Hide signing secret" : "Reveal signing secret"}
                        >
                          {isRevealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <CopyButton value={ep.secret} />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ep.events.slice(0, 4).map((ev) => (
                        <span
                          key={ev}
                          className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {ev}
                        </span>
                      ))}
                      {ep.events.length > 4 && (
                        <span
                          className="rounded-full border border-dashed px-2 py-0.5 text-[10px] text-muted-foreground"
                          title={ep.events.slice(4).join("\n")}
                        >
                          +{ep.events.length - 4} more
                        </span>
                      )}
                    </div>

                    <div className="mt-auto flex items-center justify-between border-t pt-3.5 mt-4">
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Send className="h-3.5 w-3.5" />
                        {ep.deliveryCount} deliver{ep.deliveryCount === 1 ? "y" : "ies"}
                      </span>
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                        <Switch
                          checked={ep.isActive}
                          onCheckedChange={(v) => void toggleActive(ep, v)}
                          aria-label={`${ep.isActive ? "Pause" : "Activate"} ${ep.name}`}
                        />
                        {ep.isActive ? "Active" : "Paused"}
                      </label>
                    </div>
                  </Panel>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </section>

      {/* Send test event */}
      <TestEventCard endpoints={endpoints} onSent={() => refresh()} />

      {/* Delivery log */}
      <section aria-label="Delivery log">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold">Delivery log</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Last {deliveries.length} attempts, newest first</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[130px]" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="DELIVERED">Delivered</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={endpointFilter} onValueChange={setEndpointFilter}>
              <SelectTrigger className="h-9 w-[190px]" aria-label="Filter by endpoint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All endpoints</SelectItem>
                {endpoints.map((ep) => (
                  <SelectItem key={ep.id} value={ep.id}>
                    {ep.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {deliveries.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No deliveries yet"
            description="Fire a test event above, or advance time in the time machine to generate real billing events."
          />
        ) : filteredDeliveries.length === 0 ? (
          <EmptyState icon={Search} title="No matching deliveries" description="Try clearing the filters." />
        ) : (
          <Panel className="overflow-hidden">
            <div className={cn("max-h-[60vh] overflow-auto", SCROLL_THIN)}>
              <table className="w-full min-w-[760px] text-sm">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Time</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Response</TableHead>
                    <TableHead className="pr-5 text-right">Attempts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeliveries.map((d) => (
                    <TableRow key={d.id} className="cursor-pointer" onClick={() => setSelectedDelivery(d)}>
                      <TableCell className="pl-5 text-xs text-muted-foreground">{relTime(d.createdAt, now)}</TableCell>
                      <TableCell>
                        <span className="rounded-md bg-muted px-2 py-1 font-mono text-[11px]">{d.eventType}</span>
                      </TableCell>
                      <TableCell>
                        <span className="max-w-[200px] truncate text-[13px]">{d.endpoint.name}</span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={d.status} />
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "font-mono text-xs font-semibold tabular-nums",
                            d.responseCode == null
                              ? "text-muted-foreground"
                              : d.responseCode >= 500 || d.responseCode >= 400
                                ? "text-red-600 dark:text-red-400"
                                : "text-emerald-600 dark:text-emerald-400"
                          )}
                        >
                          {d.responseCode ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="pr-5 text-right font-mono text-xs tabular-nums">{d.attempts}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          </Panel>
        )}
      </section>

      <AddEndpointDialog open={addOpen} onOpenChange={setAddOpen} onAdded={() => refresh()} />

      {/* Delivery detail */}
      <Dialog open={!!selectedDelivery} onOpenChange={(o) => !o && setSelectedDelivery(null)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          {selectedDelivery && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2.5 font-mono text-base">
                  {selectedDelivery.eventType}
                  <StatusBadge status={selectedDelivery.status} />
                </DialogTitle>
                <DialogDescription>
                  Sent to {selectedDelivery.endpoint.name} · {fmtDateTime(selectedDelivery.createdAt)} ·{" "}
                  {selectedDelivery.attempts} attempt{selectedDelivery.attempts === 1 ? "" : "s"}
                </DialogDescription>
              </DialogHeader>
              <pre
                className={cn(
                  "max-h-80 overflow-auto rounded-xl border bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-200",
                  SCROLL_THIN
                )}
              >
                {JSON.stringify(selectedDelivery.payload, null, 2)}
              </pre>
              <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <p className="leading-relaxed">
                  Signed with the endpoint's HMAC-SHA256 secret in the{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">X-Vendly-Signature</code> header — always verify
                  the signature before trusting a payload.
                </p>
              </div>
              <DialogFooter>
                <CopyButton value={JSON.stringify(selectedDelivery.payload, null, 2)} label="Copy payload" />
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TestEventCard({ endpoints, onSent }: { endpoints: WebhookEndpointDTO[]; onSent: () => void }) {
  const { toast } = useToast();
  const [eventType, setEventType] = useState<string>("invoice.paid");
  const [endpointId, setEndpointId] = useState("all");
  const [busy, setBusy] = useState(false);

  async function sendTest() {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; dispatched: number }>("/api/webhooks/test", {
        json: { eventType, ...(endpointId !== "all" ? { endpointId } : {}) },
      });
      toast({
        title: `Event dispatched to ${res.dispatched} endpoint${res.dispatched === 1 ? "" : "s"}`,
        description: `${eventType} fired — check the delivery log below.`,
      });
      onSent();
    } catch (e) {
      toast({ title: "Test event failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">Send a test event</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Dispatch a sample payload to verify an integration end-to-end.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-[1fr_1fr_auto]">
        <Select value={eventType} onValueChange={setEventType}>
          <SelectTrigger aria-label="Event type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WEBHOOK_EVENTS.map((ev) => (
              <SelectItem key={ev} value={ev} className="font-mono text-xs">
                {ev}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={endpointId} onValueChange={setEndpointId}>
          <SelectTrigger aria-label="Target endpoint" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All active endpoints</SelectItem>
            {endpoints.map((ep) => (
              <SelectItem key={ep.id} value={ep.id}>
                {ep.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => void sendTest()} disabled={busy || endpoints.length === 0}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send test event
        </Button>
      </div>
      <p className="mt-2.5 text-[11px] text-muted-foreground">
        Delivered to every active endpoint subscribed to this event — payloads are signed and retry automatically on
        failure.
      </p>
    </Panel>
  );
}

function AddEndpointDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("GENERIC");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setProvider("GENERIC");
      setUrl("");
      setEvents([]);
      setFormError(null);
      setBusy(false);
    }
  }, [open]);

  function toggleEvent(ev: string) {
    setEvents((prev) => (prev.includes(ev) ? prev.filter((x) => x !== ev) : [...prev, ev]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3) return setFormError("Endpoint name must be at least 3 characters.");
    if (!/^https?:\/\//.test(url.trim())) return setFormError("Endpoint URL must start with http:// or https://");
    if (events.length === 0) return setFormError("Subscribe to at least one event.");
    setFormError(null);
    setBusy(true);
    try {
      await api("/api/webhooks/endpoints", {
        json: { name: name.trim(), provider, url: url.trim(), events },
      });
      toast({ title: "Endpoint added", description: `${name.trim()} is ready to receive events.` });
      onAdded();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't add the endpoint", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an endpoint</DialogTitle>
          <DialogDescription>Register an HTTPS endpoint to receive signed product events.</DialogDescription>
        </DialogHeader>
        <form id="add-endpoint-form" onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="we-name">Name</Label>
            <Input id="we-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Discord Bot — Access Manager" maxLength={60} />
          </div>
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger aria-label="Provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GENERIC">
                  <span className="flex items-center gap-2">
                    <Webhook className="h-3.5 w-3.5" /> Generic (any HTTPS URL)
                  </span>
                </SelectItem>
                <SelectItem value="DISCORD_BOT">
                  <span className="flex items-center gap-2">
                    <Send className="h-3.5 w-3.5" /> Discord bot
                  </span>
                </SelectItem>
                <SelectItem value="TELEGRAM_BOT">
                  <span className="flex items-center gap-2">
                    <Send className="h-3.5 w-3.5" /> Telegram bot
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="we-url">Endpoint URL</Label>
            <Input
              id="we-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhooks/vendly"
              inputMode="url"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Events</legend>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((ev) => {
                const on = events.includes(ev);
                return (
                  <button
                    key={ev}
                    type="button"
                    onClick={() => toggleEvent(ev)}
                    aria-pressed={on}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left font-mono text-[11px] transition-colors",
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {on ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{ev}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A unique signing secret will be generated automatically — find it (and copy it) on the endpoint card.
          </p>
          {formError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-endpoint-form" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add endpoint
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB: PAYOUTS (creator balance & withdrawals)
// ============================================================================

const PAYOUT_METHODS: Record<string, { label: string; icon: LucideIcon; cls: string; note: string }> = {
  BANK: {
    label: "Bank transfer",
    icon: Landmark,
    cls: "border-emerald-500/25 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    note: "1-2 business days",
  },
  PAYPAL: {
    label: "PayPal",
    icon: Wallet,
    cls: "border-teal-500/25 bg-teal-500/12 text-teal-600 dark:text-teal-400",
    note: "Credited to your balance",
  },
  CRYPTO: {
    label: "On-chain",
    icon: Bitcoin,
    cls: "border-amber-500/25 bg-amber-500/12 text-amber-700 dark:text-amber-400",
    note: "gas paid by receiver",
  },
};

function payoutMethodMeta(method: string) {
  return PAYOUT_METHODS[method] || PAYOUT_METHODS.BANK;
}

function PayoutsTab() {
  const navigate = useAppStore((s) => s.navigate);
  const refresh = useAppStore((s) => s.refresh);

  const { data, error, loading } = useCreatorFetch(() =>
    api<{ balance: PayoutBalanceDTO; payouts: PayoutDTO[] }>("/api/payouts")
  );

  const [withdrawOpen, setWithdrawOpen] = useState(false);

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading payouts">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }
  if (error || !data) return <LoadError message={error || "Payouts unavailable."} />;

  const { balance, payouts } = data;
  const canWithdraw = balance.availableCents >= 500;

  // Creators with no products/invoices yet — keep the tab friendly.
  if (balance.grossRevenueCents === 0 && payouts.length === 0) {
    return (
      <div className="space-y-5">
        <SectionHeader title="Payouts" description="Your earnings, withdrawals and settlement history" />
        <EmptyState
          icon={Banknote}
          title="No revenue to pay out yet"
          description="Every paid invoice nets out a 3% platform fee — the rest lands here as withdrawable balance after your first sale."
          action={
            <Button onClick={() => navigate("creator", { creatorTab: "products" })}>
              <Package className="h-4 w-4" /> Create a product
            </Button>
          }
        />
      </div>
    );
  }

  const secondary: { label: string; value: string; sub: string }[] = [
    {
      label: "Pending",
      value: fmtMoney(balance.pendingCents, { cents: true }),
      sub: payouts.some((p) => p.status === "PENDING") ? "awaiting settlement" : "no withdrawals in flight",
    },
    {
      label: "Lifetime paid",
      value: fmtMoney(balance.lifetimePaidCents, { cents: true }),
      sub: "withdrawals completed",
    },
    {
      label: "Platform fees to date",
      value: fmtMoney(balance.platformFeeCents, { cents: true }),
      sub: "3% of gross revenue",
    },
    {
      label: "Gross revenue",
      value: fmtMoney(balance.grossRevenueCents, { cents: true }),
      sub: "all paid invoices",
    },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader title="Payouts" description="Your earnings, withdrawals and settlement history" />

      {/* Hero balance */}
      <Panel className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent" />
        <div className="relative p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Available balance
              </p>
              <p className="mt-2 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">
                {fmtMoney(balance.availableCents, { cents: true })}
              </p>
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                Vendly holds back a 3% platform fee on every payment.
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-2">
              <Button size="lg" className="h-11" onClick={() => setWithdrawOpen(true)} disabled={!canWithdraw}>
                <ArrowDownToLine className="h-4 w-4" /> Withdraw
              </Button>
              <p className="max-w-[220px] text-center text-[11px] leading-relaxed text-muted-foreground">
                {canWithdraw ? "Minimum withdrawal is $5.00." : "Unlocks at $5.00 earned."}
              </p>
            </div>
          </div>

          {/* Secondary stats */}
          <div className="mt-6 grid gap-3 border-t pt-5 sm:grid-cols-2 lg:grid-cols-4">
            {secondary.map((s) => (
              <div key={s.label} className="rounded-xl bg-muted/40 p-3.5">
                <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                <p className="mt-1 text-lg font-bold tabular-nums">{s.value}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {/* Info banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <p className="flex items-start gap-3 text-sm leading-relaxed">
          <Timer className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            Payouts settle when the billing engine runs — advance the time machine to simulate the settlement window
            closing.
          </span>
        </p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => navigate("creator", { creatorTab: "time" })}
        >
          <FastForward className="h-4 w-4" /> Open time machine
        </Button>
      </div>

      {/* History */}
      <section aria-label="Payout history">
        <div className="mb-3">
          <h2 className="text-sm font-bold">Payout history</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Newest first · fees are the period's 3% holdback, not an extra charge
          </p>
        </div>
        {payouts.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No withdrawals yet"
            description="Request your first payout once you've earned at least $5.00 — it settles the next time the billing engine runs."
          />
        ) : (
          <Panel className="overflow-hidden">
            <div className={cn("max-h-[60vh] overflow-auto", SCROLL_THIN)}>
              <table className="w-full min-w-[760px] text-sm">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-5">Requested</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-5 text-right">Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((p) => {
                    const meta = payoutMethodMeta(p.method);
                    const MethodIcon = meta.icon;
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="pl-5 text-xs tabular-nums text-muted-foreground">
                          {fmtDateTime(p.createdAt)}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-2">
                            <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg border", meta.cls)}>
                              <MethodIcon className="h-3.5 w-3.5" />
                            </span>
                            <span className="text-[13px] font-medium">{meta.label}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {fmtMoney(p.amountCents, { cents: true })}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                          {fmtMoney(p.feeCents, { cents: true })}
                        </TableCell>
                        <TableCell>
                          {p.status === "PENDING" ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                              Settles on next billing run
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                              <Check className="h-3 w-3" /> Paid
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="pr-5 text-right text-xs tabular-nums text-muted-foreground">
                          {p.paidAt ? fmtDate(p.paidAt) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            </div>
          </Panel>
        )}
      </section>

      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        balance={balance}
        onWithdrawn={() => refresh()}
      />
    </div>
  );
}

// ============================================================================
// Withdraw dialog
// ============================================================================

function WithdrawDialog({
  open,
  onOpenChange,
  balance,
  onWithdrawn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: PayoutBalanceDTO;
  onWithdrawn: () => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill with the full available balance each time the dialog opens.
  useEffect(() => {
    if (open) {
      setAmount((balance.availableCents / 100).toFixed(2));
      setMethod("BANK");
      setFormError(null);
      setBusy(false);
    }
  }, [open, balance.availableCents]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 500) {
      return setFormError("Minimum withdrawal is $5.00.");
    }
    if (cents > balance.availableCents) {
      return setFormError(`You can withdraw up to ${fmtMoney(balance.availableCents, { cents: true })}.`);
    }
    setFormError(null);
    setBusy(true);
    try {
      await api("/api/payouts", { json: { amountCents: cents, method } });
      toast({
        title: "Withdrawal requested",
        description: "It settles the next time the billing engine runs — advance the time machine to close the window.",
      });
      onWithdrawn();
      onOpenChange(false);
    } catch (err) {
      // 400s (min amount / exceeds balance) surface inline.
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw funds</DialogTitle>
          <DialogDescription>Request a payout from your available balance.</DialogDescription>
        </DialogHeader>
        <form id="withdraw-form" onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wd-amount">Amount (USD)</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="wd-amount"
                type="number"
                min="5.00"
                max={(balance.availableCents / 100).toFixed(2)}
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-7 pr-16 text-base tabular-nums"
              />
              <button
                type="button"
                onClick={() => setAmount((balance.availableCents / 100).toFixed(2))}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10"
              >
                Max
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Up to {fmtMoney(balance.availableCents, { cents: true })} available · minimum $5.00.
            </p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Delivery method</legend>
            <RadioGroup value={method} onValueChange={setMethod} className="grid gap-2.5">
              {(["BANK", "PAYPAL", "CRYPTO"] as const).map((m) => {
                const meta = PAYOUT_METHODS[m];
                const Icon = meta.icon;
                const selected = method === m;
                return (
                  <div key={m} className="relative">
                    <RadioGroupItem value={m} id={`wd-${m}`} className="peer sr-only" />
                    <label
                      htmlFor={`wd-${m}`}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                        selected
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:border-primary/40 hover:bg-muted/40"
                      )}
                    >
                      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", meta.cls)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-tight">{meta.label}</span>
                        <span className="block text-xs text-muted-foreground">{meta.note}</span>
                      </span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={3} aria-label="Selected" />}
                    </label>
                  </div>
                );
              })}
            </RadioGroup>
          </fieldset>

          <p className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
            <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Withdrawals settle as PENDING and are paid when the billing engine next runs — advance the time machine to
            simulate it.
          </p>

          {formError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400">
              {formError}
            </p>
          )}
        </form>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="withdraw-form" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />}
            Request withdrawal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// TAB: TIME (billing time machine)
// ============================================================================

const RUN_STEPS: { icon: LucideIcon; cls: string; title: string; text: string }[] = [
  {
    icon: RefreshCw,
    cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    title: "Renewals",
    text: "Subscriptions due for renewal are charged on their stored payment method and a new invoice is created.",
  },
  {
    icon: XCircle,
    cls: "bg-red-500/12 text-red-600 dark:text-red-400",
    title: "Dunning",
    text: "Failed charges mark the subscription PAST_DUE and retry up to 3 times — then cancel and revoke access.",
  },
  {
    icon: Sparkles,
    cls: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    title: "Trial conversion",
    text: "Ended trials convert to a paid subscription — or fail like any other charge.",
  },
  {
    icon: Ban,
    cls: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
    title: "Scheduled cancels",
    text: "cancel_at_period_end subscriptions terminate — Discord roles and license keys are revoked.",
  },
];

function runEventIcon(ev: string): { icon: LucideIcon; cls: string } {
  const l = ev.toLowerCase();
  if (l.includes("renewed")) return { icon: RefreshCw, cls: "text-emerald-400" };
  if (l.includes("canceled")) return { icon: Ban, cls: "text-rose-400" };
  if (l.includes("failed")) return { icon: XCircle, cls: "text-red-400" };
  if (l.includes("trial")) return { icon: Sparkles, cls: "text-amber-400" };
  return { icon: ChevronRight, cls: "text-zinc-500" };
}

function TimeTab() {
  const { toast } = useToast();
  const clock = useAppStore((s) => s.clock);
  const setClock = useAppStore((s) => s.setClock);
  const refresh = useAppStore((s) => s.refresh);

  const [busyDays, setBusyDays] = useState<number | null>(null);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<BillingRunResult | null>(null);
  const [customDays, setCustomDays] = useState(7);
  const [customInput, setCustomInput] = useState("7");

  const working = busyDays !== null || resetting;

  function onCustomChange(raw: string) {
    setCustomInput(raw);
    const v = Math.round(Number(raw));
    if (Number.isFinite(v) && v >= 1 && v <= 90) setCustomDays(v);
  }

  async function runAdvance(days: number) {
    setBusyDays(days);
    try {
      const res = await api<BillingRunResult>("/api/billing/advance", { json: { days } });
      setResult(res);
      setClock({ simulated: true, now: res.newNow, label: `Simulated (+${res.advancedDays}d)` });
      refresh();
      toast({
        title: `Time advanced by ${res.advancedDays} day${res.advancedDays === 1 ? "" : "s"}`,
        description: "The billing engine ran — see the run log below.",
      });
    } catch (e) {
      toast({ title: "Billing run failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusyDays(null);
    }
  }

  async function runReset() {
    setResetting(true);
    try {
      await api("/api/billing/reset", { json: {} });
      setClock({ simulated: false, now: new Date().toISOString(), label: "Live" });
      setResult(null);
      refresh();
      toast({ title: "Back to live time", description: "The clock follows real time again — billing was settled up to now." });
    } catch (e) {
      toast({ title: "Couldn't reset the clock", description: (e as Error).message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  const runStats: { label: string; value: number; icon: LucideIcon; cls: string }[] = result
    ? [
        { label: "Renewals", value: result.renewals, icon: RefreshCw, cls: "text-emerald-400" },
        { label: "Failed", value: result.renewalsFailed, icon: XCircle, cls: "text-red-400" },
        { label: "Canceled", value: result.canceled, icon: Ban, cls: "text-rose-400" },
        { label: "Trials converted", value: result.trialsConverted, icon: Sparkles, cls: "text-amber-400" },
        { label: "Invoices", value: result.invoicesCreated, icon: ReceiptText, cls: "text-teal-400" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Billing time machine"
        description="Advance the simulated clock to watch renewals, trials and dunning play out in real data"
      />

      {/* Recurring worker — automatic billing runs on a schedule */}
      <WorkerPanel />

      {/* Clock status + advance controls */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-5">
        <Panel className="p-5 sm:p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Timer className="h-4 w-4 text-primary" /> Current time
            </p>
            {clock.simulated ? (
              <Badge variant="outline" className="gap-1.5 border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                Simulated
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                Live
              </Badge>
            )}
          </div>
          <p className="mt-4 text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">{fmtDateTime(clock.now)}</p>
          {clock.simulated ? (
            <>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {clock.label} — the billing engine treats this moment as now.
              </p>
              <Button variant="outline" className="mt-5" onClick={() => void runReset()} disabled={working}>
                {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Reset to live time
              </Button>
            </>
          ) : (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Following real time — advance the clock to simulate renewals, trial conversions and dunning.
            </p>
          )}
        </Panel>

        <Panel className="p-5 sm:p-6 lg:col-span-3">
          <div className="mb-4">
            <h2 className="text-sm font-bold">Advance time</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Runs the recurring billing engine as if the selected number of days had passed.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[1, 5, 7, 30].map((d) => (
              <Button key={d} variant="outline" onClick={() => void runAdvance(d)} disabled={working}>
                {busyDays === d ? <Loader2 className="h-4 w-4 animate-spin" /> : <FastForward className="h-4 w-4" />}
                +{d} {d === 1 ? "day" : "days"}
              </Button>
            ))}
          </div>
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Custom amount</span>
              <span className="tabular-nums">
                {customDays} day{customDays === 1 ? "" : "s"}
              </span>
            </div>
            <Slider
              value={[customDays]}
              min={1}
              max={90}
              step={1}
              onValueChange={(v) => {
                const n = v[0] ?? 1;
                setCustomDays(n);
                setCustomInput(String(n));
              }}
              aria-label="Days to advance"
            />
            <div className="flex gap-2.5">
              <Input
                type="number"
                min={1}
                max={90}
                value={customInput}
                onChange={(e) => onCustomChange(e.target.value)}
                onBlur={() => setCustomInput(String(customDays))}
                className="w-24"
                aria-label="Days to advance"
              />
              <Button onClick={() => void runAdvance(customDays)} disabled={working}>
                {busyDays === customDays ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Timer className="h-4 w-4" />
                )}
                Advance {customDays} {customDays === 1 ? "day" : "days"}
              </Button>
            </div>
          </div>
        </Panel>
      </div>

      {/* Run result — terminal log */}
      <AnimatePresence>
        {result && (
          <motion.div
            key="billing-run"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            <div className="overflow-hidden rounded-xl border border-zinc-700/60 bg-zinc-900 font-mono text-zinc-100 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5 text-xs">
                <span className="flex items-center gap-2 font-semibold">
                  <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                  billing run — +{result.advancedDays}d
                </span>
                <span className="text-zinc-400">now → {fmtDateTime(result.newNow)}</span>
              </div>
              <div className="flex flex-wrap gap-2 px-4 pt-3.5">
                {runStats.map((s) => (
                  <span
                    key={s.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs"
                  >
                    <s.icon className={cn("h-3.5 w-3.5", s.cls)} />
                    <b className="tabular-nums">{s.value}</b>
                    <span className="text-zinc-400">{s.label}</span>
                  </span>
                ))}
              </div>
              <motion.ul
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
                initial="hidden"
                animate="show"
                className="space-y-1.5 px-4 py-4 text-xs sm:text-[13px]"
              >
                {result.events.length === 0 && (
                  <li className="flex items-center gap-2 text-zinc-500">
                    <ChevronRight className="h-3.5 w-3.5" />
                    No billing events in this window — try advancing further.
                  </li>
                )}
                {result.events.map((ev, i) => {
                  const meta = runEventIcon(ev);
                  const Icon = meta.icon;
                  return (
                    <motion.li
                      key={i}
                      variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }}
                      className="flex items-start gap-2"
                    >
                      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", meta.cls)} />
                      <span className="text-zinc-300">{ev}</span>
                    </motion.li>
                  );
                })}
              </motion.ul>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Explainer + scenarios */}
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel className="p-5 sm:p-6">
          <h2 className="text-sm font-bold">What happens on a billing run</h2>
          <ul className="mt-4 space-y-4">
            {RUN_STEPS.map((step) => (
              <li key={step.title} className="flex items-start gap-3">
                <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", step.cls)}>
                  <step.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-4 sm:space-y-5">
          <h2 className="text-sm font-bold">Try these experiments</h2>
          <Panel className="flex flex-col p-5">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h3 className="mt-2.5 font-semibold">Advance 5 days</h3>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
              Alex's Crypto Alpha trial ends → watch it convert to a paid $99/mo subscription (or fail).
            </p>
            <Button variant="outline" className="mt-4 self-start" onClick={() => void runAdvance(5)} disabled={working}>
              {busyDays === 5 ? <Loader2 className="h-4 w-4 animate-spin" /> : <FastForward className="h-4 w-4" />}
              Run +5 days
            </Button>
          </Panel>
          <Panel className="flex flex-col p-5">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h3 className="mt-2.5 font-semibold">Advance 31 days</h3>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
              Hugo's cancel-at-period-end subscription cancels; David's declining card triggers dunning on Crypto Alpha;
              everyone renews.
            </p>
            <Button variant="outline" className="mt-4 self-start" onClick={() => void runAdvance(31)} disabled={working}>
              {busyDays === 31 ? <Loader2 className="h-4 w-4 animate-spin" /> : <FastForward className="h-4 w-4" />}
              Run +31 days
            </Button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
