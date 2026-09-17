"use client";

// MARKETPLACE VIEWS — Discover, product detail, and multi-gateway checkout.
// Owned by Task 2-a. Rendered when store.view is one of: discover | product | checkout.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bitcoin, CalendarDays, Check, CircleAlert,
  CreditCard, FileDown, Info, KeyRound, Loader2, Lock, Mail, MessageSquare, PackageOpen, PenLine,
  RefreshCw, Search, SearchX, Send, ShieldCheck, ShoppingBag, Sparkles, Star, Users, Wallet, X,
} from "lucide-react";

import { useAppStore } from "@/lib/store";
import { api, ApiError } from "@/lib/api";
import { CATEGORIES, type AssetDTO, type PlanDTO, type ProductCardDTO, type ProductDetailDTO } from "@/lib/types";
import { fmtBytes, fmtCompact, fmtDate, fmtMoney, timeAgo } from "@/lib/format";
import {
  CategoryIcon, CopyButton, EmptyState, GatewayBadge, ProductCover, ProviderBadge, SectionHeader,
  StatusBadge, UserAvatar,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared helpers & constants
// ---------------------------------------------------------------------------

const EMPTY_PLANS: PlanDTO[] = [];
const AVATAR_COLORS = ["emerald", "violet", "rose", "amber", "cyan", "lime", "orange", "teal", "fuchsia"];
const GATEWAY_LABELS: Record<string, string> = { STRIPE: "Stripe", PAYPAL: "PayPal", CRYPTO: "Crypto" };

type GatewayKey = "STRIPE" | "PAYPAL" | "CRYPTO";

interface CryptoQuoteDTO {
  walletAddress: string;
  amountCrypto: string;
  asset: string;
  network: string;
  memo: string;
}

interface CheckoutResultDTO {
  status: string;
  subscriptionId: string;
  invoiceId?: string;
  licenseKeyId?: string | null;
  isTrial?: boolean;
  quote?: CryptoQuoteDTO;
}

interface CheckoutReceipt {
  subscriptionId: string;
  invoiceId: string;
  licenseKeyId: string | null;
  isTrial: boolean;
  gateway: string;
}

function intervalSuffix(interval: string): string {
  return interval === "year" ? "/yr" : "/mo";
}

function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

function avatarColorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Cheapest monthly plan (falls back to cheapest yearly → "/yr").
function fromPriceInfo(product: ProductCardDTO): { cents: number; suffix: string } | null {
  const active = product.plans.filter((p) => p.active);
  const monthly = active.filter((p) => p.interval === "month");
  if (monthly.length > 0) return { cents: Math.min(...monthly.map((p) => p.priceCents)), suffix: "/mo" };
  const yearly = active.filter((p) => p.interval === "year");
  if (yearly.length > 0) return { cents: Math.min(...yearly.map((p) => p.priceCents)), suffix: "/yr" };
  return null;
}

// ---------------------------------------------------------------------------
// Tiny atoms
// ---------------------------------------------------------------------------

function Stars({
  value,
  count,
  className,
  starClass = "h-3.5 w-3.5",
}: {
  value: number;
  count?: number;
  className?: string;
  starClass?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} role="img" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      <span className="flex items-center gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            className={cn(starClass, i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-muted-foreground/15 text-muted-foreground/30")}
          />
        ))}
      </span>
      {count !== undefined && <span className="text-xs text-muted-foreground">({fmtCompact(count)})</span>}
    </span>
  );
}

function CategoryChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-all",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Product card (Whop-style)
// ---------------------------------------------------------------------------

function ProductCard({ product, featured = false, index = 0 }: { product: ProductCardDTO; featured?: boolean; index?: number }) {
  const navigate = useAppStore((s) => s.navigate);
  const price = fromPriceInfo(product);
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.06, 0.5), ease: "easeOut" }}
      className="group h-full"
    >
      <button
        type="button"
        onClick={() => navigate("product", { productId: product.id })}
        aria-label={`View ${product.title} by ${product.creator.name ?? "creator"}`}
        className="flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-emerald-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative overflow-hidden">
          <ProductCover
            theme={product.coverTheme}
            category={product.category}
            title={product.title}
            className={cn("w-full transition-transform duration-300 group-hover:scale-[1.03]", featured ? "aspect-[2/1]" : "aspect-[16/9]")}
            iconClassName={featured ? "h-32 w-32" : "h-24 w-24"}
          />
          {featured && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
              <Sparkles className="h-3 w-3" /> Featured
            </span>
          )}
        </div>
        <div className={cn("flex flex-1 flex-col gap-2.5", featured ? "p-5" : "p-4")}>
          <div className="flex items-center gap-2">
            <UserAvatar name={product.creator.name} color={product.creator.avatarColor} size="sm" />
            <span className="truncate text-xs font-medium text-muted-foreground">{product.creator.name ?? "Creator"}</span>
          </div>
          <div>
            <h3 className={cn("font-semibold tracking-tight", featured ? "text-base" : "text-[15px]")}>{product.title}</h3>
            {product.tagline && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{product.tagline}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            <Stars value={product.rating} count={product.reviewCount} />
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {fmtCompact(product.membersCount)} members
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {product.accessType.map((a) => (
              <ProviderBadge key={a} provider={a} />
            ))}
          </div>
          <div className="mt-auto flex items-end justify-between border-t pt-3">
            {price ? (
              <p className="text-sm">
                <span className="text-xs text-muted-foreground">from </span>
                <span className="text-base font-bold">{fmtMoney(price.cents)}</span>
                <span className="text-xs text-muted-foreground">{price.suffix}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Free</p>
            )}
            <span
              aria-hidden
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground"
            >
              <ArrowUpRight className="h-4 w-4" />
            </span>
          </div>
        </div>
      </button>
    </motion.article>
  );
}

function ProductCardSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" aria-hidden>
      <Skeleton className={cn("w-full rounded-none", tall ? "aspect-[2/1]" : "aspect-[16/9]")} />
      <div className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Decorative QR (deterministic from seed) & confetti
// ---------------------------------------------------------------------------

function FakeQR({ seed, className }: { seed: string; className?: string }) {
  const size = 21;
  const cells = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let x = h >>> 0 || 42;
    const grid: boolean[] = [];
    for (let i = 0; i < size * size; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      grid.push(((x >>> 16) & 7) < 3);
    }
    return grid;
  }, [seed]);

  const finder = (r: number, c: number) => {
    for (const [r0, c0] of [
      [0, 0],
      [0, 14],
      [14, 0],
    ] as const) {
      const dr = r - r0;
      const dc = c - c0;
      if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
        return dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      }
    }
    return false;
  };

  return (
    <div className={cn("grid", className)} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }} role="img" aria-label="Payment QR code (simulated)">
      {Array.from({ length: size * size }, (_, i) => {
        const r = Math.floor(i / size);
        const c = i % size;
        const on = finder(r, c) || cells[i];
        return <span key={i} className={cn("aspect-square", on ? "bg-neutral-900" : "bg-white")} />;
      })}
    </div>
  );
}

const CONFETTI_COLORS = ["#10b981", "#14b8a6", "#06b6d4", "#f59e0b", "#8b5cf6", "#f43f5e"];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 32 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.9 + Math.random() * 1.5,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 6 + Math.random() * 7,
        rotate: Math.random() * 360,
        round: Math.random() > 0.5,
      })),
    []
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute -top-3"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            backgroundColor: p.color,
            borderRadius: p.round ? 999 : 2,
          }}
          initial={{ y: -16, opacity: 1, rotate: 0 }}
          animate={{ y: 340, opacity: [1, 1, 0], rotate: p.rotate + 200 }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan option card (RadioGroup-driven, used in detail view & checkout)
// ---------------------------------------------------------------------------

function PlanOption({ plan, selected }: { plan: PlanDTO; selected: boolean }) {
  return (
    <div className="relative">
      <RadioGroupItem value={plan.id} id={`plan-${plan.id}`} className="peer sr-only" />
      <Label
        htmlFor={`plan-${plan.id}`}
        className={cn(
          "block cursor-pointer rounded-2xl border p-4 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
          selected
            ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
            : "border-border hover:border-primary/40 hover:bg-muted/40"
        )}
      >
        {plan.badge && (
          <span className="absolute -top-2 right-3 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            {plan.badge}
          </span>
        )}
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 font-semibold leading-tight">
              {plan.name}
              {selected && <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} aria-label="Selected" />}
            </span>
            {plan.description && <span className="mt-1 block text-xs leading-snug text-muted-foreground">{plan.description}</span>}
            {plan.trialDays > 0 && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                <Sparkles className="h-3 w-3" />
                {plan.trialDays}-day free trial
              </span>
            )}
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-base font-bold leading-tight">{fmtMoney(plan.priceCents)}</span>
            <span className="block text-xs text-muted-foreground">{plan.interval === "year" ? "per year" : "per month"}</span>
          </span>
        </span>
      </Label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkout stepper
// ---------------------------------------------------------------------------

function Stepper({ current }: { current: number }) {
  const steps = ["Plan", "Payment", "Done"];
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2" aria-label="Checkout progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const isFinalDone = i === steps.length - 1 && current === steps.length - 1;
        return (
          <li key={label} className="flex items-center gap-1.5 sm:gap-2">
            <span
              aria-hidden
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold transition-colors",
                (done || isFinalDone) && "border-primary bg-primary text-primary-foreground",
                active && !isFinalDone && "border-primary text-primary",
                !done && !active && !isFinalDone && "border-border text-muted-foreground"
              )}
            >
              {done || isFinalDone ? <Check className="h-4 w-4" strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn("text-sm font-medium", active || isFinalDone ? "text-foreground" : "text-muted-foreground")} aria-current={active ? "step" : undefined}>
              {label}
            </span>
            {i < steps.length - 1 && <span aria-hidden className={cn("h-px w-6 sm:w-10", done || isFinalDone ? "bg-primary" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// DISCOVER VIEW
// ---------------------------------------------------------------------------

const HERO_PARTICLES = [
  { left: "10%", top: "26%", size: 9, delay: 0, duration: 5.5 },
  { left: "22%", top: "62%", size: 6, delay: 1.2, duration: 6.5 },
  { left: "78%", top: "22%", size: 7, delay: 0.6, duration: 5 },
  { left: "88%", top: "58%", size: 10, delay: 1.8, duration: 7 },
  { left: "52%", top: "16%", size: 5, delay: 2.4, duration: 6 },
  { left: "64%", top: "74%", size: 6, delay: 0.3, duration: 5.5 },
];

const HOW_IT_WORKS = [
  {
    icon: ShoppingBag,
    title: "Pick a product",
    text: "Browse verified trading desks, SaaS playbooks, communities and more — every listing shows pricing tiers, reviews and what you get.",
  },
  {
    icon: CreditCard,
    title: "Checkout with card, PayPal or crypto",
    text: "One checkout, three gateways. Free trials, automatic renewals and cancel-anytime — no lock-in, ever.",
  },
  {
    icon: KeyRound,
    title: "Get instant access",
    text: "Discord roles, Telegram channels, license keys and secure downloads are provisioned the second your payment lands.",
  },
];

function DiscoverView() {
  const params = useAppStore((s) => s.params);
  const nonce = useAppStore((s) => s.nonce);
  const { toast } = useToast();

  const [searchText, setSearchText] = useState(params.query ?? "");
  const [category, setCategory] = useState(params.category ?? "ALL");
  const [sort, setSort] = useState("featured");
  const [products, setProducts] = useState<ProductCardDTO[] | null>(null);
  const [loading, setLoading] = useState(true);

  const gridRef = useRef<HTMLDivElement>(null);
  const howRef = useRef<HTMLDivElement>(null);

  // Sync with external navigation params (e.g. header search).
  useEffect(() => {
    setSearchText(params.query ?? "");
    setCategory(params.category ?? "ALL");
  }, [params.query, params.category]);

  // Debounced catalog fetch, driven by filters + global refresh nonce.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        const q = searchText.trim();
        if (q) qs.set("q", q);
        if (category !== "ALL") qs.set("category", category);
        if (sort !== "featured") qs.set("sort", sort);
        const suffix = qs.toString();
        const res = await api<{ products: ProductCardDTO[] }>(`/api/products${suffix ? `?${suffix}` : ""}`);
        if (!cancelled) setProducts(res.products);
      } catch (e) {
        if (!cancelled) {
          setProducts([]);
          toast({ title: "Could not load products", description: (e as Error).message, variant: "destructive" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchText, category, sort, nonce, toast]);

  const featured = useMemo(() => (products ?? []).filter((p) => p.featured), [products]);
  const hasFilters = searchText.trim() !== "" || category !== "ALL";
  const totalMembers = (products ?? []).reduce((s, p) => s + p.membersCount, 0);
  const avgRating = products && products.length > 0 ? products.reduce((s, p) => s + p.rating, 0) / products.length : 0;
  const resultCount = products?.length ?? 0;

  function clearFilters() {
    setSearchText("");
    setCategory("ALL");
  }

  return (
    <div>
      {/* ------------------------------ Hero ------------------------------ */}
      <section className="relative overflow-hidden border-b">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.08] via-teal-500/[0.05] to-cyan-500/[0.09]" />
          <div className="absolute inset-0 [background-image:linear-gradient(to_right,rgba(16,185,129,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(16,185,129,0.07)_1px,transparent_1px)] [background-size:36px_36px] [mask-image:radial-gradient(ellipse_70%_70%_at_50%_30%,black_20%,transparent_75%)]" />
          <div className="absolute -top-24 left-1/4 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="absolute right-1/5 top-8 h-64 w-64 rounded-full bg-cyan-400/15 blur-3xl" />
          {HERO_PARTICLES.map((p, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full bg-emerald-500/40"
              style={{ left: p.left, top: p.top, width: p.size, height: p.size }}
              animate={{ y: [0, -14, 0], opacity: [0.25, 0.6, 0.25] }}
              transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: "easeInOut" }}
            />
          ))}
        </div>

        <div className="container relative mx-auto max-w-7xl px-4 py-16 md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="mx-auto max-w-3xl text-center"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              The all-in-one membership marketplace
            </span>
            <h1 className="mt-5 text-balance text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl md:text-5xl">
              Everything you need to{" "}
              <span className="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-clip-text text-transparent">sell, buy and run memberships</span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-balance text-base font-medium leading-relaxed text-foreground/75 md:text-lg">
              Recurring billing across Stripe, PayPal and crypto — with automatic license keys, secure file delivery and
              instant Discord &amp; Telegram access automation.
            </p>
            <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                size="lg"
                className="h-12 rounded-full px-8 text-base"
                onClick={() => gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                <ShoppingBag className="h-4.5 w-4.5" />
                Browse products
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 rounded-full border-foreground/20 bg-card/70 px-8 text-base font-semibold text-foreground backdrop-blur hover:bg-card"
                onClick={() => howRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                How it works
              </Button>
            </div>

            <dl className="mx-auto mt-10 flex max-w-xl flex-wrap items-center justify-center gap-x-10 gap-y-4">
              <div className="text-center">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Products</dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums">
                  {products === null ? <Skeleton className="mx-auto h-6 w-10" /> : resultCount}
                </dd>
              </div>
              <div className="text-center">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Members</dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums">
                  {products === null ? <Skeleton className="mx-auto h-6 w-14" /> : fmtCompact(totalMembers)}
                </dd>
              </div>
              <div className="text-center">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Avg rating</dt>
                <dd className="mt-0.5 inline-flex items-center gap-1.5 text-xl font-bold tabular-nums">
                  {products === null ? <Skeleton className="h-6 w-10" /> : <>{avgRating.toFixed(1)}<Star className="h-4 w-4 fill-amber-400 text-amber-400" /></>}
                </dd>
              </div>
            </dl>
          </motion.div>
        </div>
      </section>

      {/* ------------------------- Catalog + filters ------------------------ */}
      <section ref={gridRef} className="container mx-auto max-w-7xl scroll-mt-20 px-4 py-10" aria-label="Product catalog">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search products, communities, SaaS…"
              aria-label="Search products"
              className={cn("h-11 rounded-full border-muted bg-muted/40 pl-10", searchText && "pr-10")}
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger aria-label="Sort products" className="h-11 w-full rounded-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="featured">Featured</SelectItem>
              <SelectItem value="members">Most members</SelectItem>
              <SelectItem value="rating">Top rated</SelectItem>
              <SelectItem value="price">Price: low to high</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Filter by category">
          <CategoryChip active={category === "ALL"} onClick={() => setCategory("ALL")} icon={<Sparkles className="h-4 w-4" />} label="All" />
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c.key}
              active={category === c.key}
              onClick={() => setCategory(c.key)}
              icon={<CategoryIcon category={c.key} className="h-4 w-4" />}
              label={c.label}
            />
          ))}
        </div>

        {/* Featured — only without active filters */}
        {!hasFilters && featured.length > 0 && !loading && (
          <div className="mt-9">
            <SectionHeader title="Featured" description="Hand-picked by the Vendly team" />
            <div className="grid gap-5 sm:grid-cols-2">
              {featured.map((p, i) => (
                <ProductCard key={p.id} product={p} featured index={i} />
              ))}
            </div>
          </div>
        )}

        {/* All products */}
        <div className="mt-10">
          <SectionHeader
            title={hasFilters ? `${resultCount} ${resultCount === 1 ? "product" : "products"}` : "All products"}
            description={
              hasFilters
                ? `Matching ${searchText.trim() ? `“${searchText.trim()}”` : ""}${searchText.trim() && category !== "ALL" ? " · " : ""}${category !== "ALL" ? categoryLabel(category) : ""}`
                : "Everything the marketplace has to offer"
            }
            action={
              hasFilters ? (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                  <X className="h-3.5 w-3.5" /> Clear filters
                </Button>
              ) : undefined
            }
          />
          {loading && !products ? (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : resultCount > 0 ? (
            <div className={cn("grid gap-5 sm:grid-cols-2 lg:grid-cols-3", loading && "pointer-events-none opacity-50 transition-opacity")}>
              {products?.map((p, i) => <ProductCard key={p.id} product={p} index={i} />)}
            </div>
          ) : (
            <EmptyState
              icon={SearchX}
              title="No products found"
              description="Try a different search term or clear the filters to see everything."
              action={
                hasFilters ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      </section>

      {/* ---------------------------- How it works -------------------------- */}
      <section ref={howRef} id="how-it-works" className="scroll-mt-20 border-t bg-muted/30">
        <div className="container mx-auto max-w-7xl px-4 py-14">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45 }}
          >
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-2xl font-extrabold tracking-tight md:text-3xl">How Vendly works</h2>
              <p className="mt-2 text-muted-foreground">From browsing to instant access in three steps.</p>
            </div>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
              {HOW_IT_WORKS.map((step, i) => (
                <motion.li
                  key={step.title}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.4, delay: i * 0.12 }}
                  className="relative rounded-2xl border bg-card p-6 shadow-sm"
                >
                  <span className="absolute right-5 top-4 font-mono text-xs font-semibold text-primary/40">0{i + 1}</span>
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <step.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-bold">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
                </motion.li>
              ))}
            </ol>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRODUCT DETAIL VIEW
// ---------------------------------------------------------------------------

function AssetRow({ asset }: { asset: AssetDTO }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileDown className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{asset.name}</p>
        <p className="text-xs text-muted-foreground">
          v{asset.version} · {fmtBytes(asset.sizeBytes)} · {fmtCompact(asset.downloadCount)} downloads
        </p>
      </div>
      {asset.requiresLicense ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
          <Lock className="h-3 w-3" />
          Included with membership
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          Instant download
        </span>
      )}
    </li>
  );
}

function ReviewDialog({
  product,
  open,
  onOpenChange,
  onSubmitted,
}: {
  product: ProductDetailDTO;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setRating(5);
      setComment("");
    }
  }, [open]);

  async function submit() {
    if (comment.trim().length < 4) {
      toast({ title: "Review too short", description: "Write at least a few words about your experience.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await api(`/api/products/${product.id}/reviews`, { json: { rating, comment: comment.trim() } });
      toast({ title: "Review posted", description: "Thanks for sharing your experience!" });
      onOpenChange(false);
      onSubmitted();
    } catch (e) {
      toast({ title: "Could not post review", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review {product.title}</DialogTitle>
          <DialogDescription>Share your experience to help other buyers decide.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div>
            <Label className="text-sm font-medium">Your rating</Label>
            <RadioGroup value={String(rating)} onValueChange={(v) => setRating(Number(v))} className="mt-2.5 flex gap-1">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="relative flex items-center">
                  <RadioGroupItem value={String(i)} id={`star-${i}`} className="peer sr-only" />
                  <Label
                    htmlFor={`star-${i}`}
                    aria-label={`${i} star${i > 1 ? "s" : ""}`}
                    className="cursor-pointer rounded-lg p-2 transition-colors hover:bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
                  >
                    <Star className={cn("h-7 w-7 transition-colors", i <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
          <div>
            <Label htmlFor="review-comment" className="text-sm font-medium">
              Your review
            </Label>
            <Textarea
              id="review-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={600}
              placeholder="What did you like? What could be better?"
              className="mt-2"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{comment.length}/600</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
            Post review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailSkeleton() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8" aria-busy="true" aria-label="Loading product">
      <Skeleton className="mb-4 h-8 w-28" />
      <Skeleton className="h-40 w-full rounded-3xl md:h-56" />
      <div className="mt-6 space-y-3">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-[26rem] w-full rounded-3xl" />
      </div>
    </div>
  );
}

function ProductDetailView() {
  const params = useAppStore((s) => s.params);
  const navigate = useAppStore((s) => s.navigate);
  const nonce = useAppStore((s) => s.nonce);

  const [product, setProduct] = useState<ProductDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = useCallback(async () => {
    if (!params.productId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api<{ product: ProductDetailDTO }>(`/api/products/${params.productId}`);
      setProduct(res.product);
    } catch {
      setProduct(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [params.productId]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  const plans = product ? product.plans : EMPTY_PLANS;
  const selectedPlan = useMemo(() => {
    if (selectedPlanId) {
      const p = plans.find((x) => x.id === selectedPlanId);
      if (p) return p;
    }
    return plans.find((p) => p.badge === "Most Popular") ?? plans[0] ?? null;
  }, [selectedPlanId, plans]);

  if (loading && !product) return <DetailSkeleton />;
  if (notFound || !product) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          icon={PackageOpen}
          title="Product not found"
          description="This product may have been removed or the link is incorrect."
          action={<Button onClick={() => navigate("discover")}>Back to Discover</Button>}
        />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: "easeOut" }} className="container mx-auto max-w-7xl px-4 py-8">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 mb-4 gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => navigate("discover")}
        aria-label="Back to Discover"
      >
        <ArrowLeft className="h-4 w-4" /> Discover
      </Button>

      <ProductCover
        theme={product.coverTheme}
        category={product.category}
        title={product.title}
        className="h-40 w-full rounded-3xl md:h-56"
        iconClassName="h-32 w-32 md:h-40 md:w-40"
      />

      {/* Header */}
      <div className="mt-6 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1.5 border-primary/25 bg-primary/10 text-primary">
              <CategoryIcon category={product.category} className="h-3.5 w-3.5" />
              {categoryLabel(product.category)}
            </Badge>
            {product.status !== "ACTIVE" && <StatusBadge status={product.status} />}
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight md:text-4xl">{product.title}</h1>
          {product.tagline && <p className="mt-2 max-w-2xl text-base text-muted-foreground md:text-lg">{product.tagline}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <Stars value={product.rating} count={product.reviewCount} starClass="h-4 w-4" />
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              {fmtCompact(product.membersCount)} members
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              Launched {fmtDate(product.createdAt)}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {product.accessType.map((a) => (
              <ProviderBadge key={a} provider={a} />
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm md:w-80">
          <UserAvatar name={product.creator.name} color={product.creator.avatarColor} size="lg" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Created by</p>
            <p className="truncate font-semibold">{product.creator.name ?? "Creator"}</p>
            {product.creator.bio && <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{product.creator.bio}</p>}
          </div>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_360px] xl:gap-12">
        {/* ------------------------------ Left column ------------------------------ */}
        <div className="min-w-0 space-y-10">
          <section aria-label="About this product">
            <SectionHeader title="About this product" className="mb-4" />
            <p className="whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground">{product.description}</p>
          </section>

          <section aria-label="What you get">
            <SectionHeader
              title="What you get"
              description={selectedPlan ? `Included in the ${selectedPlan.name} plan` : undefined}
              className="mb-4"
            />
            {selectedPlan ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {selectedPlan.features.map((f, i) => (
                  <motion.li
                    key={f}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.05, 0.3) }}
                    className="flex items-start gap-2.5 rounded-xl border bg-card p-3.5 text-sm"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {f}
                  </motion.li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No plans available" description="This product is not accepting new members right now." />
            )}
          </section>

          {product.assets.length > 0 && (
            <section aria-label="Files and downloads">
              <SectionHeader title="Files & downloads" description="Secure delivery via expiring, tokenized links" className="mb-4" />
              <ul className="space-y-2">
                {product.assets.map((a) => (
                  <AssetRow key={a.id} asset={a} />
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Reviews">
            <SectionHeader
              title="Reviews"
              description={`${product.reviewCount} review${product.reviewCount === 1 ? "" : "s"} · ${product.rating.toFixed(1)} average`}
              action={
                <Button variant="outline" size="sm" onClick={() => setReviewOpen(true)}>
                  <PenLine className="h-3.5 w-3.5" /> Write a review
                </Button>
              }
              className="mb-4"
            />
            {product.reviews.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No reviews yet"
                description="Be the first to share your experience with this product."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {product.reviews.map((r, i) => (
                  <motion.li
                    key={r.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.35) }}
                    className="rounded-2xl border bg-card p-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={r.authorName} color={avatarColorFor(r.authorName)} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{r.authorName}</p>
                        <p className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</p>
                      </div>
                      <Stars value={r.rating} />
                    </div>
                    <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted-foreground">{r.comment}</p>
                  </motion.li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ------------------------------ Right column (sticky) ------------------------------ */}
        <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Pricing">
          <div className="rounded-3xl border bg-card p-5 shadow-sm md:p-6">
            {product.hasAccess ? (
              <div className="py-4 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <BadgeCheck className="h-7 w-7" />
                </div>
                <h3 className="mt-3 text-lg font-bold">You already have access</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Manage your membership, license keys and downloads from your hub.
                </p>
                <Button className="mt-4 h-11 w-full" onClick={() => navigate("portal")}>
                  Go to My Hub <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-bold">Choose your plan</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Switch tiers or cancel anytime.</p>
                <RadioGroup value={selectedPlan?.id ?? ""} onValueChange={setSelectedPlanId} className="mt-4 grid gap-3">
                  {plans.map((plan) => (
                    <PlanOption key={plan.id} plan={plan} selected={selectedPlan?.id === plan.id} />
                  ))}
                </RadioGroup>

                {selectedPlan && selectedPlan.features.length > 0 && (
                  <ul className="mt-5 space-y-2 border-t pt-4">
                    {selectedPlan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={3} />
                        <span className="text-muted-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <Button
                  size="lg"
                  className="mt-5 h-12 w-full text-base"
                  disabled={!selectedPlan}
                  onClick={() => selectedPlan && navigate("checkout", { productId: product.id, planId: selectedPlan.id })}
                >
                  Continue to checkout{selectedPlan ? ` — ${fmtMoney(selectedPlan.priceCents)}${intervalSuffix(selectedPlan.interval)}` : ""}
                </Button>
                {selectedPlan && selectedPlan.trialDays > 0 && (
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                    Includes a {selectedPlan.trialDays}-day free trial
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 border-t pt-4">
                  <GatewayBadge gateway="STRIPE" />
                  <GatewayBadge gateway="PAYPAL" />
                  <GatewayBadge gateway="CRYPTO" />
                  <span className="text-[11px] text-muted-foreground">· Cancel anytime</span>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      <ReviewDialog product={product} open={reviewOpen} onOpenChange={setReviewOpen} onSubmitted={load} />
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// CHECKOUT VIEW
// ---------------------------------------------------------------------------

function CheckoutSkeleton() {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-8" aria-busy="true" aria-label="Loading checkout">
      <Skeleton className="mb-6 h-8 w-44" />
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <Skeleton className="h-96 rounded-3xl" />
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    </div>
  );
}

function OrderSummary({
  product,
  plan,
  startTrial,
  className,
}: {
  product: ProductDetailDTO;
  plan: PlanDTO | null;
  startTrial: boolean;
  className?: string;
}) {
  const trial = !!plan && plan.trialDays > 0 && startTrial;
  const firstCharge = trial && plan ? fmtDate(new Date(Date.now() + plan.trialDays * 86400000).toISOString()) : null;
  return (
    <aside className={cn("rounded-3xl border bg-card p-5 shadow-sm md:p-6", className)} aria-label="Order summary">
      <div className="flex items-center gap-3">
        <ProductCover
          theme={product.coverTheme}
          category={product.category}
          title={product.title}
          className="h-14 w-20 shrink-0 rounded-xl"
          iconClassName="h-10 w-10"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{product.title}</p>
          <p className="truncate text-xs text-muted-foreground">by {product.creator.name ?? "Creator"}</p>
        </div>
      </div>
      <Separator className="my-4" />
      {plan ? (
        <>
          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="font-medium">{plan.name}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Billing</dt>
              <dd className="font-medium">{plan.interval === "year" ? "Yearly" : "Monthly"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Price</dt>
              <dd className="font-medium">
                {fmtMoney(plan.priceCents)}
                {intervalSuffix(plan.interval)}
              </dd>
            </div>
          </dl>
          <Separator className="my-4" />
          <div className="rounded-xl bg-muted/50 p-3.5 text-sm">
            {trial ? (
              <>
                <p className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                  <Sparkles className="h-4 w-4" /> Free trial starts today
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No charge now — first charge {firstCharge}, then {fmtMoney(plan.priceCents)}
                  {intervalSuffix(plan.interval)}.
                </p>
              </>
            ) : (
              <div className="flex items-center justify-between">
                <span className="font-medium">Today’s charge</span>
                <span className="text-base font-bold">{fmtMoney(plan.priceCents)}</span>
              </div>
            )}
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Auto-renews every {plan.interval === "year" ? "year" : "month"}. Cancel anytime.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Select a plan to continue.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t pt-4">
        <GatewayBadge gateway="STRIPE" />
        <GatewayBadge gateway="PAYPAL" />
        <GatewayBadge gateway="CRYPTO" />
      </div>
    </aside>
  );
}

// ------------------------------ Stripe form ------------------------------

function StripeForm({
  plan,
  startTrial,
  onComplete,
  onApiError,
  onFormError,
}: {
  plan: PlanDTO;
  startTrial: boolean;
  onComplete: (gateway: GatewayKey, res: CheckoutResultDTO) => void;
  onApiError: (e: unknown) => void;
  onFormError: (msg: string) => void;
}) {
  const [number, setNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [saveMethod, setSaveMethod] = useState(true);
  const [busy, setBusy] = useState(false);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 11 }, (_, i) => currentYear + i);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const digits = number.replace(/\s/g, "");
    if (!/^\d{13,19}$/.test(digits)) {
      onFormError("Enter a valid card number (13–19 digits).");
      return;
    }
    if (!expMonth || !expYear) {
      onFormError("Select the card expiry month and year.");
      return;
    }
    if (!/^\d{3,4}$/.test(cvc)) {
      onFormError("Enter the 3–4 digit security code on the back of your card.");
      return;
    }
    onFormError("");
    setBusy(true);
    try {
      const res = await api<CheckoutResultDTO>("/api/checkout", {
        json: {
          planId: plan.id,
          gateway: "STRIPE",
          startTrial,
          saveMethod,
          card: { number: digits, expMonth: Number(expMonth), expYear: Number(expYear), cvc },
        },
      });
      onComplete("STRIPE", res);
    } catch (err) {
      onApiError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="cc-number">Card number</Label>
        <div className="relative">
          <CreditCard className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="cc-number"
            inputMode="numeric"
            autoComplete="cc-number"
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 "))}
            placeholder="4242 4242 4242 4242"
            className="h-11 pl-10 font-mono"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="cc-month">Exp. month</Label>
          <Select value={expMonth} onValueChange={setExpMonth}>
            <SelectTrigger id="cc-month" className="h-11" aria-label="Expiry month">
              <SelectValue placeholder="MM" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {String(m).padStart(2, "0")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-year">Exp. year</Label>
          <Select value={expYear} onValueChange={setExpYear}>
            <SelectTrigger id="cc-year" className="h-11" aria-label="Expiry year">
              <SelectValue placeholder="YYYY" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cc-cvc">CVC</Label>
          <div className="relative">
            <Input
              id="cc-cvc"
              inputMode="numeric"
              autoComplete="cc-csc"
              value={cvc}
              onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="123"
              className="h-11 pr-9 font-mono"
            />
            <Lock className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
        <div>
          <Label htmlFor="save-card" className="text-sm font-medium">
            Save card for renewals
          </Label>
          <p className="mt-0.5 text-xs text-muted-foreground">Charged automatically each {plan.interval === "year" ? "year" : "month"}.</p>
        </div>
        <Switch id="save-card" checked={saveMethod} onCheckedChange={setSaveMethod} aria-label="Save card for renewals" />
      </div>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Test cards: <code className="rounded bg-muted px-1 font-mono">4242 4242 4242 4242</code> succeeds ·{" "}
          <code className="rounded bg-muted px-1 font-mono">4000 0000 0000 0002</code> declines
        </span>
      </p>
      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
        {startTrial ? `Start ${plan.trialDays}-day free trial` : `Pay ${fmtMoney(plan.priceCents)}`}
      </Button>
    </form>
  );
}

// ------------------------------ PayPal form ------------------------------

function PayPalForm({
  plan,
  startTrial,
  onComplete,
  onApiError,
  onFormError,
}: {
  plan: PlanDTO;
  startTrial: boolean;
  onComplete: (gateway: GatewayKey, res: CheckoutResultDTO) => void;
  onApiError: (e: unknown) => void;
  onFormError: (msg: string) => void;
}) {
  const user = useAppStore((s) => s.user);
  const [email, setEmail] = useState(user?.email ?? "");
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!v || !v.includes("@")) {
      onFormError("Enter a valid PayPal email address.");
      return;
    }
    onFormError("");
    setRedirecting(true);
    await new Promise((r) => setTimeout(r, 1200)); // simulated PayPal redirect
    setRedirecting(false);
    setBusy(true);
    try {
      const res = await api<CheckoutResultDTO>("/api/checkout", {
        json: { planId: plan.id, gateway: "PAYPAL", paypalEmail: v, saveMethod: true, startTrial },
      });
      onComplete("PAYPAL", res);
    } catch (err) {
      onApiError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="overflow-hidden rounded-2xl border border-[#ffc439]/50">
        <div className="flex items-center justify-center bg-[#ffc439] py-3">
          <span className="text-xl font-black italic tracking-tight text-[#003087]">
            Pay<span className="text-[#009cde]">Pal</span>
          </span>
        </div>
        <div className="relative space-y-4 bg-card p-5">
          <p className="text-sm text-muted-foreground">
            Pay {fmtMoney(startTrial ? 0 : plan.priceCents)} with your PayPal balance or a linked bank account.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="pp-email">PayPal email</Label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="pp-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 pl-10"
              />
            </div>
          </div>
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            You’ll approve the billing agreement in PayPal (simulated).
          </p>
          <Button
            type="submit"
            disabled={busy || redirecting}
            className="h-12 w-full rounded-full bg-[#ffc439] text-base font-bold text-[#003087] shadow-none hover:bg-[#ffd24d]"
          >
            {busy || redirecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            Continue with PayPal
          </Button>
          <AnimatePresence>
            {redirecting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-b-2xl bg-background/92 backdrop-blur-sm"
                role="status"
              >
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-sm font-semibold">Redirecting to PayPal…</p>
                <p className="text-xs text-muted-foreground">connecting billing agreement…</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </form>
  );
}

// ------------------------------ Crypto form ------------------------------

function CryptoForm({
  plan,
  startTrial,
  onComplete,
  onApiError,
  onFormError,
}: {
  plan: PlanDTO;
  startTrial: boolean;
  onComplete: (gateway: GatewayKey, res: CheckoutResultDTO) => void;
  onApiError: (e: unknown) => void;
  onFormError: (msg: string) => void;
}) {
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<CryptoQuoteDTO | null>(null);
  const [subscriptionId, setSubscriptionId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState(0);
  const [confirming, setConfirming] = useState(false);

  // Blocks 1 and 2 "arrive" on their own while waiting for the 3rd.
  useEffect(() => {
    if (!quote) return;
    setBlocks(0);
    const t1 = setTimeout(() => setBlocks(1), 1500);
    const t2 = setTimeout(() => setBlocks(2), 3200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [quote]);

  async function getQuote(e: React.FormEvent) {
    e.preventDefault();
    const v = wallet.trim();
    if (!/^0x[a-fA-F0-9]{6,}$/.test(v)) {
      onFormError("Enter a valid EVM wallet address (0x…).");
      return;
    }
    onFormError("");
    setBusy(true);
    try {
      const res = await api<CheckoutResultDTO>("/api/checkout", {
        json: { planId: plan.id, gateway: "CRYPTO", walletAddress: v, startTrial },
      });
      setQuote(res.quote ?? null);
      setSubscriptionId(res.subscriptionId);
    } catch (err) {
      onApiError(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPayment() {
    if (!subscriptionId) return;
    setBlocks(3);
    setConfirming(true);
    try {
      const res = await api<CheckoutResultDTO>("/api/checkout/crypto-confirm", { json: { subscriptionId } });
      onComplete("CRYPTO", res);
    } catch (err) {
      onApiError(err);
      setBlocks(2);
    } finally {
      setConfirming(false);
    }
  }

  if (quote) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-5 rounded-2xl border bg-card p-5 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-xl border bg-white p-2.5 shadow-sm">
            <FakeQR seed={quote.walletAddress + quote.memo} className="h-36 w-36" />
          </div>
          <div className="w-full min-w-0 flex-1 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Network</span>
              <span className="font-medium">{quote.network}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Asset</span>
              <span className="font-medium">{quote.asset}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Amount</span>
              <span className="font-mono font-bold">
                {quote.amountCrypto} {quote.asset}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Send to</span>
              <div className="mt-0.5 flex items-center gap-0.5">
                <code className="truncate font-mono text-xs">{quote.walletAddress}</code>
                <CopyButton value={quote.walletAddress} label="Copy" />
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Memo</span>
              <div className="mt-0.5 flex items-center gap-0.5">
                <code className="font-mono text-xs">{quote.memo}</code>
                <CopyButton value={quote.memo} label="Copy" />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4" role="status">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-amber-600 dark:text-amber-400" />
              Waiting for block confirmations
              <span className="flex gap-0.5" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1 w-1 animate-pulse rounded-full bg-current" style={{ animationDelay: `${i * 180}ms` }} />
                ))}
              </span>
            </p>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{Math.min(blocks, 3)}/3 blocks</span>
          </div>
          <Progress value={(Math.min(blocks, 3) / 3) * 100} className="mt-3 h-1.5" />
          <div className="mt-2.5 flex gap-1.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-2.5 w-2.5 rounded-[3px] border transition-colors",
                  i < blocks ? "border-amber-500 bg-amber-500" : "border-border bg-muted"
                )}
              />
            ))}
          </div>
        </div>

        <Button size="lg" className="h-12 w-full text-base" disabled={confirming} onClick={confirmPayment}>
          {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bitcoin className="h-4 w-4" />}
          Simulate payment confirmation (3/3 blocks)
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          Payments are simulated on Ethereum mainnet — no real funds move.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={getQuote} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="wallet">Your wallet address</Label>
        <div className="relative">
          <Bitcoin className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="wallet"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x1a2B3c4D5e6F…"
            className="h-11 pl-10 font-mono text-sm"
            spellCheck={false}
          />
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Used for renewal billing. Payments are simulated on Ethereum mainnet.
        </p>
      </div>
      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bitcoin className="h-4 w-4" />}
        Get payment quote
      </Button>
    </form>
  );
}

// ------------------------------ Payment panel ------------------------------

function PaymentPanel({
  product,
  plan,
  startTrial,
  onComplete,
  onConflict,
}: {
  product: ProductDetailDTO;
  plan: PlanDTO;
  startTrial: boolean;
  onComplete: (gateway: GatewayKey, res: CheckoutResultDTO) => void;
  onConflict: () => void;
}) {
  const { toast } = useToast();
  const [gateway, setGateway] = useState<GatewayKey>("STRIPE");
  const [banner, setBanner] = useState<string | null>(null);

  function onFormError(msg: string) {
    setBanner(msg || null);
  }

  function onApiError(e: unknown) {
    const err = e as ApiError;
    if (err.status === 409) {
      toast({ title: "Already subscribed", description: err.message, variant: "destructive" });
      onConflict();
    } else if (err.status === 402) {
      setBanner(err.message);
      toast({ title: "Payment declined", description: err.message, variant: "destructive" });
    } else {
      setBanner(err.message || "Checkout failed — please try again.");
      toast({ title: "Checkout failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <div>
      <Tabs
        value={gateway}
        onValueChange={(v) => {
          setGateway(v as GatewayKey);
          setBanner(null);
        }}
      >
        <TabsList className="grid h-auto w-full grid-cols-3 gap-2 rounded-2xl bg-transparent p-0" aria-label="Payment method">
          <TabsTrigger
            value="STRIPE"
            className="h-auto min-h-11 flex-col gap-1 rounded-2xl border border-border bg-card px-2 py-3 text-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary/10"
          >
            <CreditCard className="h-5 w-5" />
            <span className="text-xs font-semibold">Card</span>
            <span className="hidden text-[10px] font-normal text-muted-foreground sm:block">via Stripe</span>
          </TabsTrigger>
          <TabsTrigger
            value="PAYPAL"
            className="h-auto min-h-11 flex-col gap-1 rounded-2xl border border-border bg-card px-2 py-3 text-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary/10"
          >
            <Wallet className="h-5 w-5" />
            <span className="text-xs font-semibold">PayPal</span>
            <span className="hidden text-[10px] font-normal text-muted-foreground sm:block">billing agreement</span>
          </TabsTrigger>
          <TabsTrigger
            value="CRYPTO"
            className="h-auto min-h-11 flex-col gap-1 rounded-2xl border border-border bg-card px-2 py-3 text-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-sm dark:data-[state=active]:bg-primary/10"
          >
            <Bitcoin className="h-5 w-5" />
            <span className="text-xs font-semibold">Crypto</span>
            <span className="hidden text-[10px] font-normal text-muted-foreground sm:block">Ethereum</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="STRIPE" className="mt-5">
          <StripeForm plan={plan} startTrial={startTrial} onComplete={onComplete} onApiError={onApiError} onFormError={onFormError} />
        </TabsContent>
        <TabsContent value="PAYPAL" className="mt-5">
          <PayPalForm plan={plan} startTrial={startTrial} onComplete={onComplete} onApiError={onApiError} onFormError={onFormError} />
        </TabsContent>
        <TabsContent value="CRYPTO" className="mt-5">
          <CryptoForm plan={plan} startTrial={startTrial} onComplete={onComplete} onApiError={onApiError} onFormError={onFormError} />
        </TabsContent>
      </Tabs>
      <AnimatePresence>
        {banner && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{banner}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        Payments are simulated for this demo — {product.title}
      </p>
    </div>
  );
}

// ------------------------------ Success panel ------------------------------

function SuccessPanel({
  product,
  plan,
  receipt,
  onPortal,
  onDiscover,
}: {
  product: ProductDetailDTO;
  plan: PlanDTO;
  receipt: CheckoutReceipt;
  onPortal: () => void;
  onDiscover: () => void;
}) {
  const trialEnd = receipt.isTrial ? fmtDate(new Date(Date.now() + plan.trialDays * 86400000).toISOString()) : null;

  const items: { icon: LucideIcon; text: string }[] = [];
  if (receipt.isTrial && trialEnd) {
    items.push({
      icon: Sparkles,
      text: `Your ${plan.trialDays}-day free trial has started — nothing due today, first charge ${trialEnd}.`,
    });
  } else {
    items.push({ icon: CreditCard, text: `${fmtMoney(plan.priceCents)} charged via ${GATEWAY_LABELS[receipt.gateway] ?? receipt.gateway}.` });
  }
  if (receipt.licenseKeyId) {
    items.push({ icon: KeyRound, text: "License key provisioned — view it in My Hub → Licenses." });
  }
  for (const provider of product.accessType) {
    if (provider === "DISCORD") {
      items.push({ icon: Send, text: `“${product.discordRoleName || "Member"}” role assigned in Discord.` });
    } else if (provider === "TELEGRAM") {
      items.push({ icon: Send, text: `Invited to ${product.telegramChannel || "the private channel"} on Telegram.` });
    } else if (provider === "FILE") {
      items.push({ icon: FileDown, text: "Secure file downloads unlocked in the member vault." });
    }
  }

  return (
    <div className="relative overflow-hidden rounded-3xl border bg-card p-6 text-center shadow-sm md:p-10">
      <Confetti />
      <motion.div
        initial={{ scale: 0, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
        className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      >
        <Check className="h-10 w-10" strokeWidth={3} />
        <motion.span
          className="absolute inset-0 rounded-full border-2 border-emerald-500/40"
          initial={{ scale: 1, opacity: 0.8 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.9, delay: 0.35 }}
        />
      </motion.div>
      <h2 className="mt-5 text-2xl font-extrabold tracking-tight">
        {receipt.isTrial ? "Your trial has started" : "Payment successful"}
      </h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
        {product.title} · {plan.name} — {receipt.isTrial ? "no charge today" : `${fmtMoney(plan.priceCents)} paid`}
      </p>
      <ul className="mx-auto mt-6 max-w-md space-y-2 text-left">
        {items.map((item, i) => (
          <motion.li
            key={`${item.icon.name}-${i}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.12, duration: 0.3 }}
            className="flex items-start gap-3 rounded-xl border bg-background/60 px-4 py-3 text-sm"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <item.icon className="h-3.5 w-3.5" />
            </span>
            <span>{item.text}</span>
          </motion.li>
        ))}
      </ul>
      <div className="mt-7 flex flex-col justify-center gap-2.5 sm:flex-row">
        <Button size="lg" className="h-12 px-7" onClick={onPortal}>
          Go to My Hub <ArrowRight className="h-4 w-4" />
        </Button>
        <Button size="lg" variant="outline" className="h-12 px-7" onClick={onDiscover}>
          Back to Discover
        </Button>
      </div>
    </div>
  );
}

// ------------------------------ Checkout view ------------------------------

type CheckoutStep = "plan" | "payment" | "done";

function CheckoutView() {
  const params = useAppStore((s) => s.params);
  const navigate = useAppStore((s) => s.navigate);
  const refresh = useAppStore((s) => s.refresh);
  const nonce = useAppStore((s) => s.nonce);
  const { toast } = useToast();

  const [product, setProduct] = useState<ProductDetailDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(params.planId ?? null);
  const [step, setStep] = useState<CheckoutStep>(params.planId ? "payment" : "plan");
  const [receipt, setReceipt] = useState<CheckoutReceipt | null>(null);
  const [alreadySub, setAlreadySub] = useState(false);
  const [startTrial, setStartTrial] = useState(true);

  const load = useCallback(async () => {
    if (!params.productId) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotFound(false);
    try {
      const res = await api<{ product: ProductDetailDTO }>(`/api/products/${params.productId}`);
      setProduct(res.product);
    } catch {
      setProduct(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [params.productId]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  const plans = product ? product.plans : EMPTY_PLANS;
  const selectedPlan = useMemo(() => plans.find((p) => p.id === selectedPlanId) ?? null, [plans, selectedPlanId]);

  // If the plan id from params turns out invalid once loaded, fall back to plan selection.
  useEffect(() => {
    if (!loading && product && selectedPlanId && !plans.some((p) => p.id === selectedPlanId)) {
      setSelectedPlanId(null);
      setStep("plan");
    }
  }, [loading, product, selectedPlanId, plans]);

  if (loading && !product) return <CheckoutSkeleton />;
  if (notFound || !product) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          icon={PackageOpen}
          title="Product not found"
          description="This product may have been removed or the link is incorrect."
          action={<Button onClick={() => navigate("discover")}>Back to Discover</Button>}
        />
      </div>
    );
  }

  // Guard: existing subscription (pre-checked via hasAccess, or a 409 during payment).
  if (step !== "done" && (product.hasAccess || alreadySub)) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16">
        <EmptyState
          icon={BadgeCheck}
          title="You already have access to this product"
          description="Manage this membership — billing, invoices, license keys and downloads — from your hub."
          action={<Button onClick={() => navigate("portal", { portalTab: "subscriptions" })}>Go to My Hub</Button>}
        />
      </div>
    );
  }

  const trialEligible = !!selectedPlan && selectedPlan.trialDays > 0;
  const effectiveStartTrial = trialEligible && startTrial;
  const stepIndex = step === "plan" ? 0 : step === "payment" ? 1 : 2;

  const complete = (gateway: GatewayKey, res: CheckoutResultDTO) => {
    setReceipt({
      subscriptionId: res.subscriptionId,
      invoiceId: res.invoiceId ?? "",
      licenseKeyId: res.licenseKeyId ?? null,
      isTrial: !!res.isTrial,
      gateway,
    });
    setStep("done");
    refresh();
    toast({
      title: res.isTrial ? "Trial started" : "Payment successful",
      description: `${product.title} · ${selectedPlan?.name ?? ""}`.trim() || product.title,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} className="container mx-auto max-w-7xl px-4 py-8">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 mb-3 max-w-full gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={() => navigate("product", { productId: product.id })}
        aria-label="Back to product"
      >
        <ArrowLeft className="h-4 w-4 shrink-0" />
        <span className="truncate">Back to {product.title}</span>
      </Button>

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">Checkout</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Secure checkout — Stripe, PayPal and crypto
          </p>
        </div>
        <Stepper current={stepIndex} />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">
        <OrderSummary product={product} plan={selectedPlan} startTrial={effectiveStartTrial} className="h-fit lg:sticky lg:top-20 lg:order-2 lg:self-start" />

        <div className="min-w-0 lg:order-1">
          <AnimatePresence mode="wait">
            {step === "plan" && (
              <motion.div
                key="plan"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22 }}
                className="rounded-3xl border bg-card p-5 shadow-sm md:p-6"
              >
                <h2 className="text-lg font-bold">Choose your plan</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">Pick the tier that fits — change or cancel anytime.</p>
                <RadioGroup value={selectedPlan?.id ?? ""} onValueChange={setSelectedPlanId} className="mt-4 grid gap-3">
                  {plans.map((plan) => (
                    <PlanOption key={plan.id} plan={plan} selected={selectedPlan?.id === plan.id} />
                  ))}
                </RadioGroup>
                <Button size="lg" className="mt-5 h-12 w-full text-base" disabled={!selectedPlan} onClick={() => setStep("payment")}>
                  Continue to payment <ArrowRight className="h-4 w-4" />
                </Button>
              </motion.div>
            )}

            {step === "payment" && selectedPlan && (
              <motion.div
                key="payment"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22 }}
                className="rounded-3xl border bg-card p-5 shadow-sm md:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold">Payment</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {selectedPlan.name} · {fmtMoney(selectedPlan.priceCents)}
                      {intervalSuffix(selectedPlan.interval)}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setStep("plan")}>
                    <ArrowLeft className="h-4 w-4" /> Change plan
                  </Button>
                </div>

                {trialEligible && (
                  <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">Start with a {selectedPlan.trialDays}-day free trial</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        No charge today — first charge {fmtDate(new Date(Date.now() + selectedPlan.trialDays * 86400000).toISOString())}.
                      </p>
                    </div>
                    <Switch checked={startTrial} onCheckedChange={setStartTrial} aria-label="Toggle free trial" />
                  </div>
                )}

                <div className="mt-5">
                  <PaymentPanel product={product} plan={selectedPlan} startTrial={effectiveStartTrial} onComplete={complete} onConflict={() => setAlreadySub(true)} />
                </div>
              </motion.div>
            )}

            {step === "done" && receipt && selectedPlan && (
              <motion.div
                key="done"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22 }}
              >
                <SuccessPanel
                  product={product}
                  plan={selectedPlan}
                  receipt={receipt}
                  onPortal={() => navigate("portal", { portalTab: "subscriptions" })}
                  onDiscover={() => navigate("discover")}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Root view router
// ---------------------------------------------------------------------------

export function MarketplaceViews() {
  const view = useAppStore((s) => s.view);
  if (view === "product") return <ProductDetailView />;
  if (view === "checkout") return <CheckoutView />;
  return <DiscoverView />;
}
