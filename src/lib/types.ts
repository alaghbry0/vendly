// Shared types used by both server APIs and client views

export type View = "discover" | "product" | "checkout" | "portal" | "creator";

export type Role = "CUSTOMER" | "CREATOR";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  bio: string | null;
  avatarColor: string;
  discordHandle: string | null;
  telegramHandle: string | null;
  createdAt: string;
}

export interface DemoUser extends SessionUser {
  productCount?: number;
  activeSubs?: number;
}

export interface PlanDTO {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: "month" | "year";
  trialDays: number;
  badge: string | null;
  features: string[];
  sortOrder: number;
  active: boolean;
}

export interface AssetDTO {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  version: string;
  requiresLicense: boolean;
  downloadCount: number;
}

export interface ReviewDTO {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface ProductCardDTO {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  category: string;
  coverTheme: string;
  accessType: string[];
  status: string;
  featured: boolean;
  membersCount: number;
  rating: number;
  reviewCount: number;
  fromPriceCents: number | null;
  intervals: string[];
  creator: { id: string; name: string | null; avatarColor: string };
  plans: PlanDTO[];
}

export interface ProductDetailDTO extends ProductCardDTO {
  description: string;
  discordRoleName: string | null;
  telegramChannel: string | null;
  /** Default access policy for full refunds on this product
   *  (REVOKE = close access immediately, KEEP_ACCESS = goodwill until period end). */
  refundPolicy: "REVOKE" | "KEEP_ACCESS";
  createdAt: string;
  assets: AssetDTO[];
  reviews: ReviewDTO[];
  creator: { id: string; name: string | null; avatarColor: string; bio: string | null };
  hasAccess: boolean;
  affiliateBps: number | null; // active affiliate program commission (null = no program)
  bundleOffer?: { id: string; title: string; discountPct: number; productCount: number } | null; // first active bundle containing this product
}

export interface SubscriptionDTO {
  id: string;
  status: string;
  gateway: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  dunningAttempts: number;
  createdAt: string;
  product: { id: string; title: string; coverTheme: string; category: string; accessType: string[]; creator: { name: string | null } };
  plan: PlanDTO;
  paymentMethod: PaymentMethodDTO | null;
  invoiceCount: number;
  totalPaidCents: number;
}

export interface PaymentMethodDTO {
  id: string;
  type: string;
  gateway: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  email: string | null;
  walletAddress: string | null;
  chain: string | null;
  isDefault: boolean;
}

export interface InvoiceDTO {
  id: string;
  number: string;
  description: string;
  amountCents: number;
  refundedCents?: number;
  discountCents?: number;
  promoCode?: string | null;
  status: string;
  gateway: string | null;
  createdAt: string;
  paidAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  product: { id: string; title: string; coverTheme: string } | null;
}

// ============ Money-event audit trail (creator view) ============
export interface AuditEventDTO {
  id: string;
  at: string; // platform-clock ISO
  action: string; // charge.succeeded | refund.created | … (AUDIT_ACTIONS)
  actorId: string;
  actorLabel: string; // "You" | "Billing worker" | "Whop webhook" | user name…
  gateway: string | null;
  amountCents: number;
  invoiceId: string | null;
  invoiceNumber: string | null;
  subscriptionId: string | null;
  whopRef: string | null; // pay_… for Whop-routed money events
  productTitle: string | null;
  buyer: { name: string | null; email: string | null } | null;
  detail: Record<string, unknown>;
}

// Whop → Vendly ingestion feed (WhopEvent rows) as surfaced in the creator
// studio. `payloadVisible` encodes scope discipline: unmatched platform-level
// rows expose refs/outcome only, never the raw payload.
export interface WhopIngestionEventDTO {
  id: string;
  eventId: string; // evt_…
  type: string; // payment.succeeded | payment.refunded | …
  at: string; // platform-clock ISO when ingested
  outcome: "received" | "reconciled" | "noop" | "unmatched" | "no-rule" | "error";
  outcomeDetail: string;
  paymentId: string | null; // pay_… carried in the payload
  amountCents: number | null;
  payloadVisible: boolean;
  payload: string | null; // raw JSON (only when payloadVisible)
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  productTitle: string | null;
  buyer: { name: string | null; email: string | null } | null;
}

export interface LicenseDTO {
  id: string;
  key: string;
  status: string;
  planName: string | null;
  activations: number;
  maxActivations: number;
  activatedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  product: { id: string; title: string; coverTheme: string };
}

export interface GrantDTO {
  id: string;
  provider: string;
  role: string | null;
  status: string;
  grantedAt: string;
  revokedAt: string | null;
  product: { id: string; title: string; coverTheme: string };
}

export interface WebhookEndpointDTO {
  id: string;
  name: string;
  provider: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  deliveryCount: number;
}

export interface WebhookDeliveryDTO {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  createdAt: string;
  deliveredAt: string | null;
  payload: Record<string, unknown>;
  endpoint: { id: string; name: string; provider: string };
}

export interface AnalyticsDTO {
  mrrCents: number;
  arrCents: number;
  activeSubscriptions: number;
  trialingCount: number;
  pastDueCount: number;
  canceled30d: number;
  churnRate: number;
  totalRevenueCents: number;
  revenue30dCents: number;
  avgRevenuePerUserCents: number;
  subscriberSeries: { date: string; active: number; new: number; canceled: number }[];
  revenueSeries: { date: string; revenue: number; count: number }[];
  mrrSeries: { date: string; mrr: number }[];
  topProducts: { id: string; title: string; coverTheme: string; members: number; mrrCents: number; revenueCents: number }[];
  gatewayBreakdown: { gateway: string; count: number; revenueCents: number }[];
  recentActivity: { id: string; type: string; message: string; amountCents: number | null; at: string }[];
  forecast: {
    horizonDays: number;
    points: { date: string; mrr: number; low: number; high: number }[];
    projectedMrrCents: number;
    deltaPct: number;
    churnDragCents: number;
    trendLabel: "growing" | "flat" | "declining";
  };
}

// ============ Promotions ============
export interface PromoCodeDTO {
  id: string;
  code: string;
  kind: "PERCENT" | "FIXED";
  value: number;
  productId: string | null;
  productTitle: string | null;
  maxRedemptions: number;
  timesRedeemed: number;
  durationMonths: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

export interface PromoValidationDTO {
  valid: true;
  code: string;
  kind: "PERCENT" | "FIXED";
  value: number;
  discountCents: number;
  durationMonths: number;
  description: string;
}

// ============ Engagement ============
export interface WishlistItemDTO {
  id: string;
  createdAt: string;
  product: ProductCardDTO;
}

export interface NotificationDTO {
  id: string;
  type: string;
  title: string;
  body: string | null;
  icon: string;
  read: boolean;
  createdAt: string;
  target: { view: "portal" | "creator"; tab: string } | { view: "product"; productId: string } | null;
}

// ============ Payouts ============
export interface PayoutDTO {
  id: string;
  amountCents: number;
  feeCents: number;
  status: "PENDING" | "PAID";
  method: string;
  createdAt: string;
  paidAt: string | null;
}

export interface PayoutBalanceDTO {
  grossRevenueCents: number;
  platformFeeCents: number;
  availableCents: number;
  pendingCents: number;
  lifetimePaidCents: number;
  feeBps: number;
}

// ============ Affiliates ============
export interface AffiliateLinkDTO {
  id: string;
  code: string;
  clicks: number;
  conversions: number;
  active: boolean;
  createdAt: string;
  commissionBps: number;
  earnedPaidCents: number;
  earnedPendingCents: number;
  product: {
    id: string;
    title: string;
    coverTheme: string;
    status: string;
    creator: { id: string; name: string | null; avatarColor: string };
  };
}

export interface AffiliateRowDTO {
  id: string;
  code: string;
  clicks: number;
  conversions: number;
  active: boolean;
  joinedAt: string;
  earnedPaidCents: number;
  earnedPendingCents: number;
  affiliate: { id: string; name: string | null; email: string; avatarColor: string };
}

export interface AffiliateProgramDTO {
  id: string;
  commissionBps: number;
  active: boolean;
  createdAt: string;
  product: { id: string; title: string; coverTheme: string; status: string };
  affiliateCount: number;
  totalClicks: number;
  totalConversions: number;
  paidCents: number;
  pendingCents: number;
  affiliates: AffiliateRowDTO[];
}

export interface ClockDTO {
  simulated: boolean;
  now: string;
  label: string;
}

export interface BillingRunResult {
  advancedDays: number;
  newNow: string;
  renewals: number;
  renewalsFailed: number;
  canceled: number;
  trialsConverted: number;
  invoicesCreated: number;
  events: string[];
  /** Fresh clock state returned by /api/billing/advance and /api/billing/reset. */
  clock?: ClockDTO;
}

export const CATEGORIES = [
  { key: "TRADING", label: "Trading", icon: "candlestick" },
  { key: "CRYPTO", label: "Crypto", icon: "bitcoin" },
  { key: "SAAS", label: "SaaS", icon: "rocket" },
  { key: "FITNESS", label: "Fitness", icon: "dumbbell" },
  { key: "DESIGN", label: "Design", icon: "palette" },
  { key: "EDUCATION", label: "Education", icon: "graduation" },
  { key: "GAMING", label: "Gaming", icon: "gamepad" },
  { key: "OTHER", label: "Other", icon: "sparkles" },
] as const;

export const WEBHOOK_EVENTS = [
  "subscription.created",
  "subscription.renewed",
  "subscription.canceled",
  "subscription.past_due",
  "invoice.paid",
  "invoice.payment_failed",
  "license_key.created",
  "license_key.revoked",
  "access.granted",
  "access.revoked",
] as const;

// ============ Giveaways & drops ============
export interface GiveawayDTO {
  id: string;
  title: string;
  description: string;
  prize: string;
  prizeValueCents: number;
  coverTheme: string;
  status: "LIVE" | "ENDED";
  endsAt: string;
  winnerCount: number;
  memberBonus: number;
  drawnAt: string | null;
  createdAt: string;
  entryCount: number;
  product: { id: string; title: string; coverTheme: string; category: string; creator: { id: string; name: string | null; avatarColor: string } } | null;
  myEntry: number | null; // my entry count (null = not entered)
  myWin: boolean; // did I win (ended giveaways)
}

export interface GiveawayEntryRowDTO {
  id: string;
  entries: number;
  won: boolean;
  createdAt: string;
  entrant: { id: string; name: string | null; email: string; avatarColor: string };
}

export interface GiveawayCreatorDTO extends GiveawayDTO {
  winners: GiveawayEntryRowDTO[];
  recentEntries: GiveawayEntryRowDTO[];
}

export interface MyGiveawayEntryDTO {
  id: string;
  entries: number;
  won: boolean;
  createdAt: string;
  giveaway: GiveawayDTO;
}

// ============ Bundles ============
export interface BundleItemDTO {
  productId: string;
  productTitle: string;
  productSlug: string;
  coverTheme: string;
  category: string;
  planId: string;
  planName: string;
  priceCents: number;
  discountedCents: number;
  interval: string;
}

export interface BundleDTO {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  discountPct: number;
  coverTheme: string;
  active: boolean;
  creatorId: string;
  creatorName: string | null;
  createdAt: string; // ISO
  items: BundleItemDTO[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  salesCount: number;
  revenueCents: number;
  membersCount: number;
}

// ============ Creator activity feed ============
export type ActivityType =
  | "subscriber_new"
  | "payment_failed"
  | "review_new"
  | "question_new"
  | "question_answered"
  | "giveaway_entry"
  | "bundle_sold"
  | "payout";

export interface ActivityDTO {
  id: string; // source-prefixed row id (e.g. "sub-ckx…")
  type: ActivityType | string;
  title: string;
  body: string | null;
  at: string; // ISO — event timestamp
  productId: string | null; // enables deep-links to the product page
  productTitle: string | null;
  questionId?: string | null; // deep-link to the product Q&A (question/answer events)
}

// ============ Product Q&A ============
export interface AnswerDTO {
  id: string;
  body: string;
  isCreator: boolean;
  createdAt: string; // ISO
  author: { id: string; name: string; avatarColor: string };
}

export interface QuestionDTO {
  id: string;
  body: string;
  status: "OPEN" | "ANSWERED";
  createdAt: string; // ISO
  author: { id: string; name: string; avatarColor: string };
  upvotes: number;
  hasVoted: boolean; // caller's vote (false for anonymous)
  answers: AnswerDTO[]; // oldest first
  answerCount: number;
}

export interface CreatorQuestionDTO extends QuestionDTO {
  product: { id: string; title: string; coverTheme: string };
}

export interface QuestionsStatsDTO {
  open: number;
  answered: number;
  totalUpvotes: number;
  avgResponseHours: number | null; // avg hours question→first creator answer; null when no creator answers
}

export const COVER_THEMES = [
  "emerald", "teal", "amber", "rose", "violet", "cyan", "lime", "orange",
] as const;

export const STATUS_META: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Active", tone: "success" },
  TRIALING: { label: "Trialing", tone: "info" },
  PAST_DUE: { label: "Past due", tone: "warning" },
  CANCELED: { label: "Canceled", tone: "muted" },
  PENDING: { label: "Pending", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  FAILED: { label: "Failed", tone: "destructive" },
  REFUNDED: { label: "Refunded", tone: "muted" },
  OPEN: { label: "Open", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  REVOKED: { label: "Revoked", tone: "destructive" },
  SYNCED: { label: "Synced", tone: "success" },
  EXPIRED: { label: "Expired", tone: "muted" },
  LIVE: { label: "Live", tone: "success" },
  ENDED: { label: "Ended", tone: "muted" },
  ANSWERED: { label: "Answered", tone: "success" },
};
