"use client";

// Shared presentational components used across all views.
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AVATAR_GRADIENTS, COVER_THEMES } from "@/lib/format";
import { STATUS_META } from "@/lib/types";
import {
  Bitcoin, CandlestickChart, Check, Copy, Dumbbell, Gamepad2, GraduationCap,
  KeyRound, Palette, Rocket, Send, Sparkles, FileDown, type LucideIcon,
} from "lucide-react";
import { useState } from "react";

// ---------- Category icons ----------
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  TRADING: CandlestickChart,
  CRYPTO: Bitcoin,
  SAAS: Rocket,
  FITNESS: Dumbbell,
  DESIGN: Palette,
  EDUCATION: GraduationCap,
  GAMING: Gamepad2,
  OTHER: Sparkles,
};

export function CategoryIcon({ category, className }: { category: string; className?: string }) {
  const Icon = CATEGORY_ICONS[category] || Sparkles;
  return <Icon className={className} />;
}

// ---------- Avatars ----------
export function UserAvatar({
  name,
  color,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  color: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const initials = (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const sizes = { sm: "h-7 w-7 text-[10px]", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm" };
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-sm",
        AVATAR_GRADIENTS[color] || AVATAR_GRADIENTS.emerald,
        sizes[size],
        className
      )}
      aria-label={name || "User avatar"}
    >
      {initials}
    </div>
  );
}

// ---------- Status pill ----------
const TONE_CLASSES: Record<string, string> = {
  success: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400 border-emerald-500/25",
  warning: "bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/25",
  destructive: "bg-red-500/12 text-red-700 dark:text-red-400 border-red-500/25",
  info: "bg-teal-500/12 text-teal-700 dark:text-teal-400 border-teal-500/25",
  muted: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status] || { label: status, tone: "muted" };
  return (
    <Badge variant="outline" className={cn("font-medium", TONE_CLASSES[meta.tone], className)}>
      {status === "PAST_DUE" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />}
      {meta.label}
    </Badge>
  );
}

// ---------- Access provider chip ----------
const PROVIDER_META: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  DISCORD: { label: "Discord", icon: Send, cls: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25" },
  TELEGRAM: { label: "Telegram", icon: Send, cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25" },
  LICENSE: { label: "License key", icon: KeyRound, cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25" },
  FILE: { label: "File vault", icon: FileDown, cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25" },
  LINK: { label: "Link", icon: Sparkles, cls: "bg-muted text-muted-foreground border-border" },
};

export function ProviderBadge({ provider, className }: { provider: string; className?: string }) {
  const meta = PROVIDER_META[provider] || PROVIDER_META.LINK;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        meta.cls,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  );
}

// ---------- Gateway chip ----------
const GATEWAY_META: Record<string, { label: string; cls: string }> = {
  STRIPE: { label: "Card · Stripe", cls: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/25" },
  PAYPAL: { label: "PayPal", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/25" },
  CRYPTO: { label: "Crypto", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25" },
};

export function GatewayBadge({ gateway, className }: { gateway: string; className?: string }) {
  const meta = GATEWAY_META[gateway] || { label: gateway, cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.cls, className)}>
      {gateway === "STRIPE" && <span className="inline-block h-2 w-3 rounded-[2px] bg-gradient-to-br from-violet-500 to-fuchsia-500" />}
      {gateway === "PAYPAL" && <span className="text-[10px] font-black italic">P</span>}
      {gateway === "CRYPTO" && <Bitcoin className="h-3 w-3" />}
      {meta.label}
    </span>
  );
}

// ---------- Product cover ----------
export function ProductCover({
  theme,
  category,
  title,
  className,
  iconClassName,
}: {
  theme: string;
  category: string;
  title: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div
      role="img"
      aria-label={`${title} cover`}
      className={cn("relative overflow-hidden bg-gradient-to-br", COVER_THEMES[theme] || COVER_THEMES.emerald, className)}
    >
      <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px),radial-gradient(circle_at_80%_60%,white_1px,transparent_1px)] [background-size:24px_24px,32px_32px]" />
      <div className="absolute -right-6 -bottom-8 rotate-[-8deg] opacity-90">
        <CategoryIcon category={category} className={cn("h-28 w-28 text-white/30", iconClassName)} />
      </div>
    </div>
  );
}

// ---------- Copy button ----------
export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground", className)}
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      aria-label={label || "Copy to clipboard"}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {label ? <span>{copied ? "Copied!" : label}</span> : null}
    </Button>
  );
}

// ---------- Empty state ----------
export function EmptyState({
  icon: Icon = Sparkles,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed p-10 text-center", className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- Stat card ----------
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  trend,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  trend?: { value: string; up: boolean };
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md", className)}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {trend && (
          <span className={cn("text-xs font-semibold", trend.up ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            {trend.up ? "↑" : "↓"} {trend.value}
          </span>
        )}
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

// ---------- Section header ----------
export function SectionHeader({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
