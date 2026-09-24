"use client";

// Whop Elements checkout — real card payments through Whop (sandbox).
//
// Embeds Whop's hosted, PCI-isolated payment fields (EmailElement +
// CardElement + BrandingElement) inside Vendly's own checkout page. Card data
// is typed directly into iframes served from cdn.whop.com and never touches
// this app: the element mints a single-use confirmation token (ctok_…) which
// POST /api/checkout/whop-confirm settles server-side against the Whop API.
//
// Trial checkouts mount the Payments group in setup mode — the card is
// validated and saved via a Whop setup intent without a charge.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadWhop, type WhopConstructor } from "@whop/elements";
import {
  BrandingElement,
  CardElement,
  EmailElement,
  Payments,
  WhopElements,
  usePayments,
  useWhop,
} from "@whop/elements-react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { BadgeCheck, CircleAlert, CreditCard, Loader2, Lock, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface WhopCheckoutResult {
  status: "COMPLETED" | "PENDING_ACTION" | "PENDING";
  subscriptionId?: string;
  invoiceId?: string;
  licenseKeyId?: string | null;
  isTrial?: boolean;
  discountCents?: number;
  promoCode?: string | null;
  referral?: { code: string; affiliateName: string | null; commissionCents: number } | null;
  whopRef?: string;
  clientSecret?: string | null;
  kind?: "payment" | "setup";
  whop?: { paymentId: string; amount: string; currency: string; card: string } | null;
  // Bundle checkouts (whop-confirm with bundleId) return the bundle receipt shape.
  bundle?: boolean;
  purchaseId?: string;
  items?: { productTitle: string; planName: string; subscriptionId: string; invoiceId: string; licenseKeyId: string | null; amountCents: number; interval: string }[];
}

/** When set, the form charges a BUNDLE total instead of a plan (Task 3-b):
 *  the confirm POST sends { bundleId, confirmationToken } and the 3DS poll
 *  appends &bundleId=… — no trial, no promo, no planId. */
export interface WhopBundleTarget {
  id: string;
  itemCount: number;
}

const COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "ES", name: "Spain" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "EG", name: "Egypt" },
  { code: "TR", name: "Türkiye" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "JP", name: "Japan" },
  { code: "SG", name: "Singapore" },
];

export function WhopForm({
  planId,
  planName,
  currency,
  payAmountCents,
  startTrial,
  trialDays,
  promoCode,
  refCode,
  bundle,
  payLabel,
  onComplete,
  onApiError,
}: {
  planId?: string;
  planName?: string;
  currency?: string;
  payAmountCents: number;
  startTrial?: boolean;
  trialDays?: number;
  promoCode?: string | null;
  refCode?: string | null;
  /** Charge this bundle instead of a plan (bundle checkouts never trial). */
  bundle?: WhopBundleTarget;
  /** Overrides the idle pay-button label (defaults to "Pay $X with card"). */
  payLabel?: string;
  onComplete: (res: WhopCheckoutResult) => void;
  onApiError: (e: unknown) => void;
}) {
  // The SDK loader touches `document`, so it is created client-side only —
  // `elements={null}` defers the provider until the promise lands.
  const [sdk, setSdk] = useState<WhopConstructor | Promise<WhopConstructor | null> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve(); // run past the effect body (SSR-safe mount)
      if (cancelled || typeof window === "undefined") return;
      try {
        setSdk(loadWhop());
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load Whop Elements.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const appearance = useMemo(
    () => ({ theme: { appearance: resolvedTheme === "dark" ? ("dark" as const) : ("light" as const) } }),
    [resolvedTheme]
  );

  if (loadError) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-400" role="alert">
        <p className="flex items-center gap-2 font-semibold">
          <CircleAlert className="h-4 w-4" /> Whop Elements failed to load
        </p>
        <p className="mt-1 text-xs opacity-80">{loadError}</p>
        <Button variant="outline" size="sm" className="mt-3 h-9" onClick={() => window.location.reload()}>
          <RefreshCw className="h-3.5 w-3.5" /> Reload checkout
        </Button>
      </div>
    );
  }

  // Wait for next-themes to resolve before mounting — the elements' color
  // scheme is baked into their iframes at boot, so the provider is keyed on
  // the theme to rebuild fully when light/dark toggles.
  if (!resolvedTheme) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-11 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <WhopElements
      key={resolvedTheme}
      elements={sdk}
      environment="sandbox"
      appearance={appearance}
      onLoadError={(err, retry) => {
        console.warn("[whop] element load error:", err.message);
        setLoadError(err.message);
        void retry;
      }}
    >
      <PaymentsBoundary
        planId={planId}
        currency={currency}
        payAmountCents={payAmountCents}
        startTrial={startTrial}
        trialDays={trialDays}
        promoCode={promoCode}
        refCode={refCode}
        bundle={bundle}
        payLabel={payLabel}
        onComplete={onComplete}
        onApiError={onApiError}
      />
    </WhopElements>
  );
}

// ---------------------------------------------------------------------------
// Payments group + pay button (must render inside <Payments>)
// ---------------------------------------------------------------------------

function PaymentsBoundary(props: {
  planId?: string;
  currency?: string;
  payAmountCents: number;
  startTrial?: boolean;
  trialDays?: number;
  promoCode?: string | null;
  refCode?: string | null;
  bundle?: WhopBundleTarget;
  payLabel?: string;
  onComplete: (res: WhopCheckoutResult) => void;
  onApiError: (e: unknown) => void;
}) {
  const user = useAppStore((s) => s.user);
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [line1, setLine1] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [cardComplete, setCardComplete] = useState(false);
  const [emailComplete, setEmailComplete] = useState(false);
  const [busy, setBusy] = useState<null | "token" | "confirm" | "action">(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pay = useCallback(
    async (payments: ReturnType<typeof usePayments>, whop: ReturnType<typeof useWhop>) => {
      setFormError(null);
      setStatusNote(null);
      if (!name.trim()) {
        setFormError("Enter the name on your card.");
        return;
      }
      if (!line1.trim()) {
        setFormError("Enter your billing street address.");
        return;
      }
      if (!postalCode.trim()) {
        setFormError("Enter your billing postal / ZIP code.");
        return;
      }
      if (!email.trim() || !email.includes("@")) {
        setFormError("Enter a valid email for your receipt.");
        return;
      }
      if (!payments) return;

      setBusy("token");
      let ctok: string;
      try {
        const t = await payments.createConfirmationToken({
          billingDetails: {
            email: email.trim(),
            name: name.trim(),
            address: { line1: line1.trim(), postal_code: postalCode.trim(), country },
          },
        });
        ctok = t.confirmationToken;
      } catch (e) {
        setBusy(null);
        setFormError(e instanceof Error ? e.message : "Couldn't read the card fields — please try again.");
        return;
      }

      setBusy("confirm");
      try {
        const res = await api<WhopCheckoutResult>(
          "/api/checkout/whop-confirm",
          props.bundle
            ? { json: { bundleId: props.bundle.id, confirmationToken: ctok } }
            : {
                json: {
                  planId: props.planId,
                  confirmationToken: ctok,
                  startTrial: props.startTrial,
                  promoCode: props.promoCode ?? undefined,
                  refCode: props.refCode ?? undefined,
                },
              }
        );
        if (res.status === "COMPLETED") {
          props.onComplete(res);
          return;
        }
        if (res.status === "PENDING_ACTION" && res.whopRef) {
          // 3DS / bank step (clientSecret present) or a charge/setup that is
          // still processing at Whop (no secret) — either way, Whop drives the
          // dialog when possible, then we poll the backend for the outcome.
          setBusy("action");
          setStatusNote(res.clientSecret ? "Confirming with your bank…" : "Confirming your card…");
          if (res.clientSecret && whop) {
            try {
              await whop.payments.handleNextAction({
                clientSecret: res.clientSecret,
                returnUrl: window.location.href,
              });
            } catch {
              /* dialog dismissed — poll anyway, the payment may still settle */
            }
          }
          // Poll the backend until the payment settles (max ~40s).
          const ref = res.whopRef;
          const deadline = Date.now() + 40_000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2200));
            try {
              const poll = await api<WhopCheckoutResult>(
                props.bundle
                  ? `/api/checkout/whop-status?ref=${encodeURIComponent(ref)}&bundleId=${props.bundle.id}`
                  : `/api/checkout/whop-status?ref=${encodeURIComponent(ref)}&planId=${props.planId}` +
                      `${props.promoCode ? `&promoCode=${encodeURIComponent(props.promoCode)}` : ""}` +
                      `${props.refCode ? `&refCode=${encodeURIComponent(props.refCode)}` : ""}`
              );
              if (poll.status === "COMPLETED") {
                if (mounted.current) props.onComplete(poll);
                return;
              }
            } catch (e) {
              if (e instanceof ApiError && e.status === 402) throw e;
              // transient poll failure — keep trying
            }
          }
          throw new ApiError("Payment is still pending confirmation — check My Hub in a moment.", 402);
        }
        throw new ApiError("Payment is still pending — please try again.", 402);
      } catch (e) {
        if (mounted.current) {
          setBusy(null);
          setStatusNote(null);
          props.onApiError(e);
        }
      }
    },
    [country, email, line1, name, postalCode, props]
  );

  const accountId = process.env.NEXT_PUBLIC_WHOP_BUSINESS_ID || "biz_6Keq0VvsuY0pR6";
  const returnUrl = typeof window === "undefined" ? undefined : window.location.href;
  // The options are a discriminated union: setup mode saves the card without
  // charging (trial), payment mode charges the inline amount. BOTH modes ask
  // Whop to save the card for off_session use — that's what makes renewals
  // REAL later (the billing engine charges the saved payt_ card via the Whop
  // API). Bundles always charge the bundle total — no trial, no promo.
  const trialMode = !props.bundle && props.startTrial;

  // FIX (SETUP_CHARGE_CONFLICT): Whop's SDK merges update() options into the
  // LIVE handle (hosted updateOptions does Object.assign), so toggling the
  // trial switch payment → setup leaked the stale `amount` key into the setup
  // mount and the controller rejected the whole charge state. Two defenses:
  //   1. `key` on <Payments> — a mode flip recreates the handle from scratch
  //      with pristine options instead of updating in place.
  //   2. Explicit `plan/amount: undefined` in the setup options (the SDK's own
  //      setup type declares them `?: undefined`) — this overwrites any value
  //      that could still leak through an in-place update path.
  const paymentsOptions = trialMode
    ? {
        accountId,
        mode: "setup" as const,
        currency: (props.currency || "usd").toLowerCase(),
        plan: undefined,
        amount: undefined,
        setupFutureUsage: "off_session" as const,
        returnUrl,
      }
    : {
        accountId,
        mode: "payment" as const,
        currency: (props.currency || "usd").toLowerCase(),
        amount: props.payAmountCents,
        setupFutureUsage: "off_session" as const,
        returnUrl,
      };

  // A mode flip remounts the card iframe — reset the local completeness
  // trackers so the pay button can't fire on a stale "card complete" flag.
  useEffect(() => {
    setCardComplete(false);
  }, [trialMode]);

  // Live mount-mode chip — the trial toggle switches this element between a
  // setup mount (card saved, nothing charged) and a payment mount (inline
  // charge today). Surfacing the active mode here keeps the buyer oriented
  // after a flip, because the secure card form reloads on the switch.
  const modeChip = trialMode ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
      <ShieldCheck className="h-3 w-3" /> Setup · $0.00 today
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-px text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
      <Zap className="h-3 w-3" /> Charge · ${(props.payAmountCents / 100).toFixed(2)} today
    </span>
  );

  return (
    <Payments key={trialMode ? "setup" : "payment"} {...paymentsOptions}>
      {/* Header — real payments badge + live mount-mode chip */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-3.5 py-2.5 dark:bg-emerald-500/10">
        <p className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          <Zap className="h-3.5 w-3.5" />
          Real card payment · Whop sandbox{props.bundle ? ` · ${props.bundle.itemCount}-product bundle` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {modeChip}
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            PCI-isolated fields by Whop
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Email (Whop)</p>
          <EmailElement
            defaultValue={user?.email ?? ""}
            onChange={(p) => {
              setEmail(p.email);
              setEmailComplete(p.complete);
            }}
            fallback={<Skeleton className="h-11 w-full rounded-xl" />}
          />
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Card details (Whop)</p>
          <CardElement
            onChange={(p) => setCardComplete(p.complete)}
            fallback={
              <div className="space-y-2">
                <Skeleton className="h-11 w-full rounded-xl" />
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-11 rounded-xl" />
                  <Skeleton className="h-11 rounded-xl" />
                </div>
              </div>
            }
          />
        </div>

        {/* Billing details — required by Whop for card confirmation tokens */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="whop-name">Name on card</Label>
            <Input
              id="whop-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Morgan"
              autoComplete="cc-name"
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whop-country">Billing country</Label>
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger id="whop-country" className="h-11" aria-label="Billing country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="whop-line1">Billing street address</Label>
            <Input
              id="whop-line1"
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              placeholder="42 Market Street"
              autoComplete="billing street-address"
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="whop-postal">Postal / ZIP code</Label>
            <Input
              id="whop-postal"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="94105"
              autoComplete="billing postal-code"
              className="h-11"
            />
          </div>
        </div>

        <WhopPayButton
          onPay={pay}
          payAmountCents={props.payAmountCents}
          startTrial={trialMode}
          trialDays={props.trialDays}
          payLabel={props.payLabel}
          bundleNote={!!props.bundle}
          disabled={!cardComplete || (!emailComplete && !email.includes("@"))}
          busy={busy}
          statusNote={statusNote}
        />

        {formError && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-400"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {formError}
          </motion.p>
        )}

        {/* Sandbox test cards */}
        <div className="rounded-xl border bg-muted/30 p-3.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <BadgeCheck className="h-3.5 w-3.5" /> Sandbox test cards
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[
              { n: "4242 4242 4242 4242", d: "succeeds" },
              { n: "4000 0000 0000 0002", d: "declines" },
              { n: "5385 3083 6013 5181", d: "3D Secure" },
            ].map((c) => (
              <code
                key={c.n}
                className={cn(
                  "rounded-lg border px-2 py-1 font-mono text-[11px] font-semibold",
                  c.d === "succeeds" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                  c.d === "declines" && "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400",
                  c.d === "3D Secure" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                )}
                title={`Test card — ${c.d}`}
              >
                {c.n}
                <span className="ml-1.5 font-sans font-normal opacity-70">({c.d})</span>
              </code>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Type a test card above, any future expiry and any CVC. A real charge is created in the Whop sandbox — no funds move.
          </p>
        </div>

        <BrandingElement fallback={<div className="h-6" />} />
      </div>
    </Payments>
  );
}

// ---------------------------------------------------------------------------
// Pay button — reads the live payments handle
// ---------------------------------------------------------------------------

function WhopPayButton({
  onPay,
  payAmountCents,
  startTrial,
  trialDays,
  payLabel,
  bundleNote,
  disabled,
  busy,
  statusNote,
}: {
  onPay: (payments: ReturnType<typeof usePayments>, whop: ReturnType<typeof useWhop>) => void;
  payAmountCents: number;
  startTrial?: boolean;
  trialDays?: number;
  payLabel?: string;
  bundleNote?: boolean;
  disabled: boolean;
  busy: null | "token" | "confirm" | "action";
  statusNote: string | null;
}) {
  const payments = usePayments();
  const whop = useWhop();
  const amount = `$${(payAmountCents / 100).toFixed(2)}`;

  return (
    <div>
      <Button
        type="button"
        size="lg"
        className="h-12 w-full text-base tabular-nums"
        disabled={disabled || busy !== null}
        onClick={() => onPay(payments, whop)}
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {statusNote || (busy === "token" ? "Reading card…" : "Charging card…")}
          </>
        ) : (
          <>
            <Lock className="h-4 w-4" />
            {startTrial && trialDays ? `Start ${trialDays}-day free trial` : payLabel || `Pay ${amount} with card`}
          </>
        )}
      </Button>
      <p className="mt-2.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <CreditCard className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        Charged via Whop Elements ·{" "}
        {startTrial ? "card saved, nothing charged today" : bundleNote ? "one charge for the whole bundle" : "one-time charge for this period"}
      </p>
    </div>
  );
}
