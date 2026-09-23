// Whop payments integration (sandbox by default).
//
// The checkout embeds Whop Elements (hosted card fields served from
// cdn.whop.com — card data never touches our server). The client mints a
// single-use confirmation token (ctok_…) from the element; this module
// confirms it server-side against the Whop API:
//
//   • one-time payment  → POST /payments      (inline find-or-create plan)
//   • trial card save   → POST /setup_intents (card validated, nothing charged)
//
// Docs: https://docs.whop.com/elements/latest/payments/overview
// Sandbox: https://docs.whop.com/developer/guides/sandbox

const API_KEY = process.env.WHOP_API_KEY || "";
const BASE_URL = (process.env.WHOP_API_BASE_URL || "https://sandbox-api.whop.com/api/v1").replace(/\/$/, "");
export const WHOP_BUSINESS_ID = process.env.WHOP_BUSINESS_ID || "";

export interface WhopMoney {
  currency: string;
  amount: string;
}

export interface WhopCardInfo {
  brand?: string | null;
  last4?: string | null;
  exp_month?: number | null;
  exp_year?: number | null;
}

export interface WhopPayment {
  id: string;
  status: string; // paid | open | failed | …
  substatus: string; // succeeded | failed | incomplete | processing | …
  client_secret: string | null;
  failure_message: string | null;
  decline_code: string | null;
  customer_email: string | null;
  total?: WhopMoney;
  payment_instrument?: { card?: WhopCardInfo | null } | null;
  metadata?: Record<string, string> | null;
}

export interface WhopSetupIntent {
  id: string;
  status: string; // succeeded | processing | requires_action | canceled | …
  client_secret?: string | null;
  error_message: string | null;
  payment_method?: {
    id?: string;
    card?: WhopCardInfo | null;
  } | null;
}

class WhopApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function whopFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new WhopApiError(502, "Could not reach Whop — check your connection and try again.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = (data as { error?: { message?: string } | string }).error;
    const message =
      (typeof err === "string" ? err : err?.message) || `Whop request failed (${res.status}).`;
    throw new WhopApiError(res.status, message);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Inline "find or create" plan for one-time charges.
// Whop matches an existing plan on the product's external_identifier +
// pricing terms, so repeat checkouts reuse the same Whop plan.
// ---------------------------------------------------------------------------

export interface WhopInlinePlanInput {
  productTitle: string;
  productSlug: string;
  planName: string;
  amountDollars: number;
  currency: string;
}

function inlinePlan(input: WhopInlinePlanInput) {
  const title = `${input.productTitle} · ${input.planName}`.slice(0, 30);
  return {
    currency: input.currency.toLowerCase(),
    plan_type: "one_time" as const,
    initial_price: input.amountDollars,
    title,
    visibility: "hidden" as const,
    product: {
      external_identifier: `vendly-${input.productSlug}`.slice(0, 60),
      title: input.productTitle.slice(0, 30),
      visibility: "hidden" as const,
    },
  };
}

export interface CreatePaymentResult {
  payment: WhopPayment;
}

// Confirms a checkout confirmation token as a one-time card payment.
// Returns as soon as Whop acknowledges the payment; the charge may still be
// settling (substatus "incomplete") — poll getPayment for the outcome.
export function createWhopPayment(opts: {
  confirmationToken: string;
  email: string;
  plan: WhopInlinePlanInput;
  returnUrl: string;
  metadata?: Record<string, string>;
}): Promise<WhopPayment> {
  return whopFetch<WhopPayment>("/payments", {
    method: "POST",
    body: JSON.stringify({
      account_id: WHOP_BUSINESS_ID,
      confirmation_token: opts.confirmationToken,
      email: opts.email,
      plan: inlinePlan(opts.plan),
      return_url: opts.returnUrl,
      metadata: { source: "vendly", ...opts.metadata },
    }),
  });
}

// Saves a card for future use without charging (free-trial checkout).
// The element must be mounted in mode:"setup" with
// setupFutureUsage:"off_session" for the token to be accepted here.
export function createWhopSetupIntent(opts: {
  confirmationToken: string;
  metadata?: Record<string, string>;
}): Promise<WhopSetupIntent> {
  return whopFetch<WhopSetupIntent>("/setup_intents", {
    method: "POST",
    body: JSON.stringify({
      account_id: WHOP_BUSINESS_ID,
      confirmationToken: opts.confirmationToken,
      metadata: { source: "vendly", ...opts.metadata },
    }),
  });
}

export function getWhopPayment(id: string): Promise<WhopPayment> {
  return whopFetch<WhopPayment>(`/payments/${encodeURIComponent(id)}`);
}

export function getWhopSetupIntent(id: string): Promise<WhopSetupIntent> {
  return whopFetch<WhopSetupIntent>(`/setup_intents/${encodeURIComponent(id)}`);
}

// ---------------------------------------------------------------------------
// Settlement helpers
// ---------------------------------------------------------------------------

export type WhopOutcome =
  | { kind: "succeeded"; payment: WhopPayment }
  | { kind: "failed"; message: string }
  | { kind: "pending"; clientSecret: string | null; payment: WhopPayment };

// Classifies a payment after the create call / during polling.
export function classifyPayment(payment: WhopPayment): WhopOutcome {
  if (payment.substatus === "succeeded" || payment.status === "paid") {
    return { kind: "succeeded", payment };
  }
  if (payment.substatus === "failed" || payment.status === "failed" || payment.failure_message) {
    return {
      kind: "failed",
      message: payment.failure_message || "Your card was declined. Try a different payment method.",
    };
  }
  // Still settling — may need 3DS / buyer action.
  return { kind: "pending", clientSecret: payment.client_secret, payment };
}

// Polls a payment for up to `timeoutMs` waiting for the charge to settle
// (test cards settle in a couple of seconds; declines surface the same way).
export async function waitForPayment(
  id: string,
  timeoutMs = 9000,
  intervalMs = 1200
): Promise<WhopOutcome> {
  const deadline = Date.now() + timeoutMs;
  let last: WhopPayment | null = null;
  while (Date.now() < deadline) {
    last = await getWhopPayment(id);
    const outcome = classifyPayment(last);
    if (outcome.kind !== "pending" || outcome.clientSecret) return outcome;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last ? classifyPayment(last) : { kind: "failed", message: "Payment timed out." };
}

export { WhopApiError };
