# Vendly — Whop-style Marketplace & Membership Platform

## Project Overview
A full digital marketplace + membership platform (Whop clone) built as a **single-page app** at `/` with
client-side view switching. Next.js 16 App Router + TypeScript + Tailwind 4 + shadcn/ui + Prisma (SQLite)
+ Zustand. Payments are simulated server-side across three gateways (Stripe / PayPal / Crypto).

## Architecture Summary
- **Routing**: user only ever sees `/`. `src/components/app-shell.tsx` switches between view components
  based on `useAppStore().view`: `discover | product | checkout` → `<MarketplaceViews/>`, `portal` → `<PortalViews/>`, `creator` → `<CreatorViews/>`.
- **Session**: demo auth. Client attaches `x-user-id` header via `api()` helper (`src/lib/api.ts`).
  Demo users switchable from the header dropdown. `POST /api/auth/login {email}` creates/finds a user.
- **Simulated clock** ("time machine"): `SystemClock` table. `POST /api/billing/advance {days}` advances
  simulated time and runs the recurring billing engine (renewals, dunning → PAST_DUE → cancel after 3
  failures, trial conversions, cancel_at_period_end). `POST /api/billing/reset` returns to live time.
- **Webhooks**: event-driven access management. Events: subscription.created/renewed/canceled/updated/past_due,
  invoice.paid/payment_failed, license_key.created/revoked, access.granted/revoked. Endpoint providers:
  DISCORD_BOT / TELEGRAM_BOT / GENERIC. Delivery simulated (URL containing "fail"/"500" → FAILED).
- **License keys**: auto-provisioned when product accessType includes LICENSE. Format WHPL-XXXX-XXXX-XXXX,
  max activations, revoke. `POST /api/licenses/validate {key}` = public validation endpoint.
- **Secure delivery**: `POST /api/assets/{id}/link` mints a 10-minute / 3-use token → `GET /api/download/{token}` streams the file.
- **Theme**: emerald accent (NO blue/indigo as primary), light + dark mode via next-themes, rounded-2xl cards.

## Key Files
- Store: `src/lib/store.ts` — `useAppStore` (user, users, view, params{productId,planId,query,category,portalTab,creatorTab}, clock, nonce, navigate, switchUser, refresh, bootstrap)
- API client: `src/lib/api.ts` — `api(path, {method?, json?})` throws `ApiError(message)` on failure
- Types: `src/lib/types.ts` — ALL DTOs (ProductCardDTO, ProductDetailDTO, SubscriptionDTO, InvoiceDTO, LicenseDTO, GrantDTO, WebhookEndpointDTO, WebhookDeliveryDTO, AnalyticsDTO, BillingRunResult, STATUS_META, CATEGORIES, WEBHOOK_EVENTS)
- Formatters: `src/lib/format.ts` — fmtMoney(cents), fmtCompact, fmtDate, fmtDateTime, fmtBytes, timeAgo, timeUntil, COVER_THEMES
- Shared UI: `src/components/shared.tsx` — UserAvatar, StatusBadge(status), ProviderBadge(DISCORD|TELEGRAM|LICENSE|FILE), GatewayBadge(STRIPE|PAYPAL|CRYPTO), ProductCover, CopyButton, EmptyState, StatCard, SectionHeader, CategoryIcon
- Toaster: `useToast()` from `@/hooks/use-toast` (already in layout). Use `toast({title, description, variant?})`
- All shadcn/ui components exist in `src/components/ui/`

## API Contract (all JSON; `x-user-id` header required unless marked public)

### Session
- `GET /api/bootstrap` → `{users: DemoUser[], clock: {simulated, now, label}}` (public)
- `POST /api/auth/login {email}` → SessionUser (public, creates if new)
- `GET /api/me` → SessionUser
- `PATCH /api/me {name?, discordHandle?, telegramHandle?, bio?, role?}` → SessionUser

### Catalog
- `GET /api/products?q=&category=&sort=featured|members|rating|price&creatorId=` → `{products: ProductCardDTO[]}` (public)
- `GET /api/products/{id}` → `{product: ProductDetailDTO}` (public; hasAccess=true when caller has active sub)
- `POST /api/products {title, tagline?, description, category, accessType: string[], discordRoleName?, telegramChannel?, plans: [{name, description?, priceCents, interval: month|year, trialDays?, badge?, features: string[]}]}` → `{product}` (creator)
- `PATCH /api/products/{id} {title?, tagline?, description?, category?, status?: ACTIVE|PAUSED, featured?, discordRoleName?, telegramChannel?, accessType?: string[]}` → `{product: ProductDetailDTO}`
- `POST /api/products/{id}/reviews {rating: 1-5, comment}` → `{review: ReviewDTO}`

### Checkout (multi-gateway)
- `POST /api/checkout {planId, gateway: STRIPE|PAYPAL|CRYPTO, startTrial?: bool, card?: {number, expMonth, expYear, cvc}, paypalEmail?, walletAddress?, saveMethod?}`
  - STRIPE/PAYPAL success → `{status: "COMPLETED", subscriptionId, invoiceId, licenseKeyId?, isTrial}` (201). Card ending 0002/9995 declines → 402 `{error}`.
  - CRYPTO → `{status: "PENDING_CRYPTO", subscriptionId, quote: {walletAddress, amountCrypto, asset, network, memo}, plan}` (202)
- `POST /api/checkout/crypto-confirm {subscriptionId}` → `{status: "COMPLETED", subscriptionId, invoiceId, licenseKeyId?, isTrial}`

### Customer portal
- `GET /api/subscriptions` → `{subscriptions: SubscriptionDTO[]}` (includes plan, product, paymentMethod, invoiceCount, totalPaidCents)
- `PATCH /api/subscriptions/{id} {action}`:
  - `cancel` (at period end) → `{ok, message}`
  - `resume` → `{ok, message}`
  - `cancel_now` → `{ok, message}` (revokes access + licenses)
  - `change_plan {planId}` → `{ok, message}` (proration credit applied)
  - `update_payment {paymentMethodId}` → `{ok, message}`
- `GET /api/invoices?subscriptionId=` → `{invoices: InvoiceDTO[]}`
- `GET /api/payment-methods` → `{paymentMethods: PaymentMethodDTO[]}`
- `POST /api/payment-methods {type: CARD|PAYPAL|CRYPTO, card?, paypalEmail?, walletAddress?, makeDefault?}` → `{paymentMethod}`
- `PATCH /api/payment-methods/{id}` (set default) → `{ok}`; `DELETE /api/payment-methods/{id}` → `{ok}`
- `GET /api/licenses` → `{licenses: LicenseDTO[]}`
- `POST /api/licenses/{id}/activate` → `{ok, activations, maxActivations, device}`
- `DELETE /api/licenses/{id}/activate` → revoke → `{ok}`
- `POST /api/licenses/validate {key}` → `{valid, reason?, product?, plan?, activations, maxActivations}` (public)
- `GET /api/grants` → `{grants: GrantDTO[]}` (Discord/Telegram role sync status)
- `POST /api/assets/{id}/link` → `{url: "/api/download/<token>", expiresIn, maxUses, fileName}` (open url to download)

### Creator
- `GET /api/analytics` → `{analytics: AnalyticsDTO}` (mrrCents, arrCents, activeSubscriptions, trialingCount, pastDueCount, canceled30d, churnRate, totalRevenueCents, revenue30dCents, avgRevenuePerUserCents, subscriberSeries, revenueSeries, mrrSeries, topProducts, gatewayBreakdown, recentActivity)
- `GET /api/creator/orders` → `{orders: [{id, number, customer, product, planName, description, amountCents, status, gateway, createdAt, paidAt}]}`
- `GET /api/creator/subscribers` → `{subscribers: [{id, customer, product, plan, status, gateway, cancelAtPeriodEnd, dunningAttempts, currentPeriodEnd, trialEndsAt, createdAt, lifetimeValueCents, paymentMethod}]}`
- `GET /api/webhooks/endpoints` → `{endpoints: WebhookEndpointDTO[]}`
- `POST /api/webhooks/endpoints {name, provider: DISCORD_BOT|TELEGRAM_BOT|GENERIC, url, events: string[]}` → `{endpoint}` (201)
- `PATCH /api/webhooks/endpoints/{id} {isActive?, name?, events?}` → `{ok}`; `DELETE …/{id}` → `{ok}`
- `GET /api/webhooks/deliveries?endpointId=&status=&type=` → `{deliveries: WebhookDeliveryDTO[]}` (payload = parsed JSON)
- `POST /api/webhooks/test {eventType, endpointId?}` → `{ok, dispatched}`
- `POST /api/billing/advance {days: 1-90}` → BillingRunResult `{advancedDays, newNow, renewals, renewalsFailed, canceled, trialsConverted, invoicesCreated, events: string[]}`
- `POST /api/billing/reset` → `{ok, message}`

### Demo data (seeded)
- Creators: Marcus Chen (marcus@whoply.io, 3 products incl. Trade Signals Pro featured), Aisha Rahman (aisha@whoply.io, 3 products)
- Customers: Alex Rivera (alex@demo.io — primary, 2 active subs + 1 trial on Crypto Alpha + 1 canceled, 3 payment methods incl. crypto wallet, license key WHPL-7K2M-QX9R-4T8V), David Kim (card ending 0002 → his Crypto Alpha sub is PAST_DUE with 2 dunning attempts), Emma Sokolov, Farid Haddad, Gina Park, Hugo Laurent (cancel_at_period_end), Iris Nakamura
- Alex's trial on Crypto Alpha ends in ~4 days — advancing time 5+ days converts it (or fails).

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Foundation — schema, engines, seed, APIs, app shell

Work Log:
- Designed full Prisma schema (User, Product, Plan, Subscription, PaymentMethod, Invoice, LicenseKey, DigitalAsset, DownloadToken, AccessGrant, WebhookEndpoint, WebhookDelivery, Review, SystemClock) and pushed to SQLite
- Built libs: clock (simulated time), session (x-user-id demo auth), gateways (Stripe/PayPal/Crypto sims incl. declining cards), licenses (key gen + HMAC signing), webhooks (dispatch + access grant/revoke), billing (provisioning, renewals, dunning, trial conversion, time machine), analytics (MRR/churn/series), serialize, invoice-number
- Seeded 9 users, 6 products, 14 plans, 15 subscriptions with 90-day invoice history, 4 licenses, 20 access grants, 4 webhook endpoints + 10 deliveries, 14 reviews, digital assets with content
- Implemented all API routes (24 route files): bootstrap, auth/login, me, products (+[id], reviews), checkout (+crypto-confirm), subscriptions (+[id] actions), invoices, payment-methods (+[id]), licenses (+activate, validate), assets link, download token, grants, webhooks (endpoints, deliveries, test), analytics, billing (advance, reset), creator (orders, subscribers)
- Built app shell: emerald theme (light+dark), sticky header w/ search + nav + user switcher + login dialog, sticky footer, view router, zustand store, api client, shared components (avatars, badges, covers, stat cards, empty states)
- Placeholder view files created for the three view modules

Stage Summary:
- Foundation complete and lint-clean; APIs verified with curl (bootstrap + login working)
- Next: Task 2-a/2-b/2-c build the three view modules in parallel (marketplace-views.tsx, portal-views.tsx, creator-views.tsx)

---
Task ID: 2-a
Agent: general-purpose (marketplace views)
Task: Implement marketplace experience (Discover / Product detail / multi-gateway Checkout) in marketplace-views.tsx

Work Log:
- Read worklog.md, store/api/types/format/shared/app-shell to absorb contracts, theme conventions and building blocks
- Replaced the placeholder in src/components/views/marketplace-views.tsx with the full implementation (~2.1k lines, single file, "use client", exports MarketplaceViews routing on useAppStore().view)
- Discover: emerald→teal→cyan gradient hero with decorative grid + floating particles, headline/sub-copy CTAs (Browse products scrolls to grid, How it works), live stats row (products / total members / avg rating); category chips from CATEGORIES + search synced with params.query + sort Select (featured/members/rating/price) driving debounced GET /api/products; Featured section (aspect-[2/1] cards + Featured ribbon) then All-products grid (1/2/3 cols); Whop-style cards (ProductCover 16/9 watermark icon, hover lift+shadow, creator row, tagline line-clamp-2, stars + review count, members fmtCompact, ProviderBadge chips, from $X/mo via cheapest monthly else /yr); How-it-works 3 steps (ShoppingBag/CreditCard/KeyRound); skeletons + EmptyState with clear-filters
- Product detail: back breadcrumb, rounded-3xl cover banner (h-40 md:h-56), title/tagline/category badge/stars/members/launched date/provider chips/creator card; lg two-column — left: description (whitespace-pre-line), What-you-get of selected plan (Check rows), assets list (version/fmtBytes/downloads + Lock "Included with membership" when requiresLicense), reviews grid + Write-a-review dialog (star RadioGroup + textarea → POST /api/products/{id}/reviews → refetch); right sticky top-20 pricing card: plan tier RadioGroup cards (badge, trial pill, price/mo|/yr), selected-plan features, CTA "Continue to checkout — $X/mo", hasAccess success banner + "Go to My Hub", gateway microcopy row
- Checkout: Stepper (Plan → Payment → Done), sticky order summary (cover thumb, plan, interval, trial note with first-charge date, today's charge / "Free trial starts today", auto-renew hint); plan step when planId missing; payment step with gateway Tabs styled as cards — STRIPE (auto-format card number, exp month/year Selects, CVC, save-card Switch default on, test-card helper incl. 0002 decline), PAYPAL (styled panel, email, 1.2s "Redirecting to PayPal… connecting billing agreement…" overlay), CRYPTO (wallet input → PENDING_CRYPTO quote → deterministic CSS-grid QR from address+memo hash, address/memo CopyButtons, amount ETH + network, animated 3/3 block confirmations with Progress, "Simulate payment confirmation" → crypto-confirm, simulated-mainnet note); trial toggle when trialDays>0; 402 → red banner + destructive toast, 409 → toast + portal redirect, invalid planId falls back to plan step; success panel with spring check + confetti, provisioned-access rows (trial start, charge amount, license key, Discord role / Telegram invite / file vault), "Go to My Hub" (portalTab subscriptions) / "Back to Discover", calls refresh()
- Framer-motion throughout (page/card entrance, staggered lists, step transitions via AnimatePresence) — subtle, no blue/indigo primary; all money via fmtMoney(cents); mobile-first with 44px targets, aria labels/roles, semantic sections
- Fixed 4 dangling aria-labelledby refs on product-detail sections → aria-label
- Verified: bun run lint exit 0 (zero errors/warnings), dev.log shows clean compiles + GET / 200
- End-to-end API verification as throwaway user qa-2a@vendly.dev: STRIPE trial → 201 {status COMPLETED, isTrial true}; STRIPE decline card → 402 error banner path; STRIPE retry on LICENSE product → licenseKeyId provisioned; CRYPTO → 202 PENDING_CRYPTO with quote {walletAddress, amountCrypto, asset, network, memo} → crypto-confirm → COMPLETED; PAYPAL → COMPLETED; duplicate sub → 409; review POST → 201 ReviewDTO; GET /api/products/{id} → hasAccess true

Stage Summary:
- Marketplace views complete and production-quality: Discover (hero/filters/featured/grid/how-it-works), ProductDetail (plans, features, assets, reviews) and the multi-gateway Checkout (Stripe/PayPal/Crypto with pending-quote flow) all implemented, lint-clean and compile-verified; every API contract the views consume was exercised live end-to-end
- Decisions: default selected plan = "Most Popular" badge plan; featured section hidden while filters are active; order summary first in DOM for mobile, order-2 sticky on lg; crypto blocks 1-2 auto-arrive on timers, block 3 via the simulate button; FakeQR is a deterministic FNV/LCG hash grid (no external QR lib)
- Note for downstream agents: QA user "Qa 2a" (qa-2a@vendly.dev) now exists with 4 subs (incl. 1 trial on Trade Signals Pro, 1 license key) and 1 review — intentional live-test residue, harmless to demo data; switch users via the header dropdown
- No other files were modified

---
Task ID: 2-b
Agent: general-purpose (customer portal views)
Task: Implement the customer self-service billing portal ("My Hub") in portal-views.tsx — overview, memberships, licenses, downloads, invoices, payment methods, settings

Work Log:
- Read worklog.md + store/api/types/format/shared/app-shell/ui components to absorb contracts and conventions; found portal-views.tsx already contained a near-complete draft of this exact task from an interrupted prior run (~2.6k lines, all 7 tabs present) — audited it line-by-line against the spec and live API shapes instead of rewriting
- Fixed spec gaps and defects found in the audit: removed unused `Clock` lucide import; usePortalData now refetches on nonce AND user-id changes (guards the null→logged-in edge); sidebar sticky top-24→top-20 (matches spec + marketplace convention); canceled-card banner reworded to "Access ended {date} — community roles and license keys were revoked"; validate-key input pre-filled with Alex's WHPL-7K2M-QX9R-4T8V; secure-link toast now derives "valid N min / M uses" from the response (expiresIn/maxUses) instead of hardcoding; invoices table wrapped in max-h-[34rem] overflow-y-auto with a thin custom scrollbar (scrollbar-color/width + webkit thumb styling); crypto payment-method card full wallet address now break-all (no overflow); fixed TS2345 null-safety on the "Download receipt" onClick (selected could be null inside the closure)
- Tab implementations (as wired in the file): store-driven tab system synced from params.portalTab (internal clicks call navigate("portal", {portalTab})), desktop w-56 sticky sidebar + mobile horizontal scrollable pill tabs (role=tablist, hidden scrollbars), full-page skeleton, sign-in empty state, error state with retry
- Overview: welcome header (UserAvatar, first name, member since), 4 StatCards (active memberships, monthly-normalized spend, lifetime paid from PAID invoices, trials w/ "—" fallback), top-4 memberships compact list with next-charge/cancels/trial line + Manage, recent invoices mini-list (last 5, product/number/amount/status), Access & roles card (SYNCED non-revoked grants with ProviderBadge + role + product)
- Memberships: rich cards sorted PAST_DUE→TRIALING→ACTIVE→CANCELED; header (cover, title/creator/plan, StatusBadge, GatewayBadge, access ProviderBadges, member since, price/interval); period box (current period range, next charge amount+date, or trial first-charge); payment-method box with inline Select → PATCH update_payment (PAST_DUE hint about auto-retry); amber "Cancels at period end" banner + Resume; destructive PAST_DUE banner w/ dunning count; muted CANCELED card w/ Re-subscribe → navigate("product"); trial countdown chip; Manage DropdownMenu (Change tier…, View invoices, Cancel at period end…, Cancel immediately…) with plan-listing dialog (current plan disabled/badged, proration message toasted from server) and two AlertDialog confirms
- Licenses: "Validate a key" utility card calling the public POST /api/licenses/validate with result panel (valid: product/plan/activations/last-used; invalid: friendly reason map for NOT_FOUND/REVOKED/SUBSCRIPTION_INACTIVE, 404 handled); license cards with masked key + Eye/EyeOff reveal + CopyButton, activations Progress bar ("N of M device activations used"), activatedAt/lastUsedAt, "Activate on new device" (409 limit message surfaced) and AlertDialog revoke (destructive tone + revoked notice)
- Downloads: groups assets by ACTIVE/TRIALING membership via per-product GET /api/products/{id}; emerald security banner ("single-use expiring token tied to your membership"); asset rows with mime-typed file icon, version chip, fmtBytes, download count, Lock "License required" badge; download → POST /api/assets/{id}/link → window.open + toast + counter refetch; 403 errors surfaced destructively; two empty states with "Browse marketplace" CTAs
- Invoices: summary StatCards (lifetime paid, paid-this-year via sim clock, failed count), status Select (ALL/PAID/FAILED/REFUNDED) + membership Select (auto-set when jumping from a membership card, clearable), shadcn Table (number/description/date/period/gateway/amount/status) inside the scroll container, row click → detail Dialog (all fields + billed-to) with client-side .txt receipt download via Blob
- Payment methods: gradient brand chip / PayPal P / Bitcoin+chain cards with Default badge, used-by memberships, whole-card + button "Set default" (PATCH), delete AlertDialog (DELETE, 409 in-use error toasted); add dialog with Card/PayPal/Crypto Tabs (client validation, 4242 test hint, wallet regex), "Set as default" Switch; amber "simulated environment — no real charges" banner
- Settings: profile form (name/bio w/ char counter → PATCH /api/me → setUser), connected accounts card (Discord/Telegram handles + webhook-role explanation), account info (avatar preview, read-only email, role badge, member since); forms re-sync on demo-account switch
- Verification: `bun run lint` exit 0 with zero output; `bunx tsc --noEmit` → 0 errors in portal-views.tsx; dev.log shows 0 failed compiles and GET / → 200 repeatedly
- Live API verification (read-only as Alex; mutations on the throwaway QA user qa-2a@vendly.dev): GET subscriptions/invoices/payment-methods/licenses/grants shapes + desc invoice ordering confirmed; PATCH update_payment / cancel / resume / cancel_now / change_plan all return {ok, message} (proration credit message confirmed: "Proration credit −$14.99 applied, charged $24.01 today"); license activate → 200×3 then 409 "Device limit reached (3)…"; DELETE activate → {ok} and validate then returns {valid:false, reason:"REVOKED"}; payment-methods POST/PATCH-default/DELETE + 409 in-use message confirmed; POST /api/assets/{id}/link → {url, expiresIn:600, maxUses:3, fileName} and GET /api/download/{token} streams 200

Stage Summary:
- Customer portal complete and production-quality: all 7 tabs implemented in a single "use client" file exporting PortalViews, Stripe-portal-grade UX (rounded-2xl cards, skeletons, empty states with CTAs, tabular-nums money via fmtMoney, aria labels, framer-motion entrance/stagger, emerald-only theming), lint- and type-clean, with every consumed API contract exercised live end-to-end
- Decisions: tab state is fully store-driven (navigate with portalTab param) so deep links from checkout ("Go to My Hub" → subscriptions) and cross-tab jumps work for free; data loads via one Promise.all on mount/nonce/user-id change; PAST_DUE retry is an inline payment-method Select (spec-offered option) with dunning copy; invoices "View invoices" from a membership card pre-sets that membership's filter; receipt is a client-side Blob .txt (no PDF dependency)
- Residue note: QA user "Qa 2a" was further mutated for testing — its Design Vault sub was cancel_now'ed (now CANCELED), its license WHPL-ZS23-EE9X-VAQX-FJKZ hit max activations then was revoked, and one throwaway Visa was added/defaulted/deleted — intentional live-test residue, harmless to demo data (Alex's data untouched)
- Handoff notes for other agents (NOT fixed — outside my file scope): `bunx tsc --noEmit` reports 10 type errors in src/app/api/creator/orders/route.ts (Prisma include `product`/relations `user`/`subscription` not in Invoice include type — likely needs `include: { product: true, user: true, subscription: true }` typed against the schema or manual mapping) and 1 null-safety error in marketplace-views.tsx:1984 ('product' is possibly 'null'); an older PrismaClientValidationError for /api/invoices seen mid-log was already resolved by its owner (endpoint returns 200 with product)
- Only src/components/views/portal-views.tsx was modified

---
Task ID: 2-c
Agent: general-purpose (creator dashboard views) — completed by main agent after subagent timeout
Task: Implement the Creator Studio dashboard (analytics, products, subscribers, orders, webhooks, billing time machine) in creator-views.tsx

Work Log:
- Subagent wrote the full 3,161-line creator-views.tsx (all 6 tabs: overview with MRR/revenue/subscriber/gateway charts via recharts, products with 2-step creation dialog, subscribers CRM with expandable rows, orders with filters, webhook console with endpoints + delivery log + test events, time machine with advance/reset/scenarios) but hit a context deadline before lint-fixing and worklog append
- Main agent fixed 2 lint errors: useCreatorFetch ref-during-render (moved assignment into effect) and setState-in-effect for tab sync (tab now derived from params.creatorTab store state)
- Fixed TS null-safety in marketplace-views.tsx complete() (converted hoisted function to const arrow so narrowing applies)
- Fixed creator/orders route: Invoice has no product relation in Prisma schema — replaced invalid include with manual product map lookup

Stage Summary:
- All three view modules (marketplace 2,114 lines, portal 2,609 lines, creator 3,161 lines) complete
- Full project: eslint clean, tsc clean (app code), dev server compiling and serving 200s
- Next: agent-browser end-to-end QA of the golden paths

---
Task ID: 9
Agent: main (Z.ai Code)
Task: Integration, QA (agent-browser + VLM design review), fixes, final verification

Work Log:
- Launched 3 view subagents (2-a marketplace, 2-b portal, 2-c creator); 2-c timed out after writing its file — main agent fixed its 2 lint errors (ref-during-render → effect assignment; setState-in-effect → tab derived from store params) and appended its worklog entry
- Fixed TS errors: marketplace-views complete() null-safety (hoisted function → const arrow); creator/orders route invalid Prisma include (Invoice has no product relation — manual product map join)
- agent-browser end-to-end QA: discover → product detail (FitCore) → checkout → Stripe card payment (4242…, 12/2028, 123) → success screen → My Hub deep-link → memberships/licenses/downloads/invoices tabs → user switch to Marcus → Creator Studio (all 4 charts, top products, activity) → webhooks console (fired test event, dispatched 1, delivery log DELIVERED) → time machine (+5d run: 1 trial converted, invoices created, clock chip appeared in header) → subscribers CRM (statuses, LTV, Cancels chips) → orders (gross volume, INV list) → mobile viewport 390x844 + footer-at-bottom verified (footerAtBottom:true)
- VLM design review of screenshots: discover 8/10 (fixed: hero secondary button contrast, sub-headline weight), creator 7/10 (fixed: empty-looking daily revenue chart → weekly aggregation with wider bars, sidebar w-56→w-60), checkout 8/10 (fixed: Done stepper step now solid-completed styling)
- Sandbox dev server was OOM-killed during QA (Turbopack + Chrome + VLM concurrently) — restarted detached via setsid; verified 200s; recommend the cron reviewer avoid running VLM + browser simultaneously
- Re-seeded pristine demo data (Alex's pending crypto trial restored for the time-machine story), clock reset to Live, QA screenshots cleaned up

Stage Summary:
- App is fully functional end-to-end: marketplace browsing, multi-gateway checkout (Stripe/PayPal/Crypto pending-confirm flow), subscription lifecycle management (cancel/resume/change-tier with proration), license provisioning/activation/validation, secure tokenized downloads, webhook event fan-out with delivery log, creator analytics (MRR/churn/series/gateway mix), billing time machine
- eslint clean, tsc clean (app code), zero console errors, zero server errors
- Remaining known nit: QA residue user "Qa 2a" removed by re-seed; simulated-time label persists only while user advances time (by design)
