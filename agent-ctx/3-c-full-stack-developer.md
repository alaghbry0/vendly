# Task 3-c — Creator Activity Feed (work record)

Agent: full-stack-developer (Task 3-c)
Date: 2026-09-23 (sandbox clock)

## Scope
Worklog recommendation #3 (round 13): aggregate webhook-style events + Q&A + reviews into a creator timeline. New Creator Studio "Activity" tab (2nd position) with a vertical timeline + a compact "Recent activity" card on the creator overview.

## Files changed
- `src/lib/types.ts` — added `ActivityType` union + `ActivityDTO` (id/type/title/body/at/productId/productTitle/questionId?)
- `src/app/api/creator/activity/route.ts` — NEW: `GET /api/creator/activity?limit=50` (limit clamped 1–100, default 50)
- `src/components/views/creator-views.tsx` — "activity" in CreatorTab union + CREATOR_TABS (2nd, Activity icon) + tab switch; `ActivityTab` (filter chips, day-grouped timeline, stagger animation, empty states, summary badges); `RecentActivityCard` replacing the old analytics-fed `RecentActivity` + removed obsolete `activityIcon`; imports: CheckCheck, Ticket, useReducedMotion, ActivityDTO
- Screenshots: `download/qa-15-activity-{light,overview,dark,mobile}.png`

## Backend contract
`GET /api/creator/activity?limit=N` → `{ activities: ActivityDTO[] }`, `at`-descending, capped.
Sources (creator-scoped): subscriptions (bundleTitle=null — bundle subs excluded to avoid double counting vs bundle_sold), FAILED invoices, reviews, questions, creator's answers (via question→product creatorId), giveaway entries (giveaway.creatorId), bundle purchases (bundle.creatorId, items length), payouts. Each: `{id: "<prefix>-<rowId>", type, title, body, at, productId, productTitle, questionId?}`.
Categories (client map): sales = subscriber_new/bundle_sold/payout/payment_failed; community = review_new/question_new/question_answered/giveaway_entry.

## Verification (all PASS)
- API: Marcus 41 events (subscriber_new 9, review_new 9, giveaway_entry 11, question_new 6, question_answered 3, payout 2, bundle_sold 1), sorted desc; Alex (non-creator) `{activities:[]}` no crash; no auth → 401; limit=5 → 5; limit=999 → clamped to 41; Aisha 20 events.
- Browser as Marcus: Activity tab 2nd position; 41 timeline items in 33 day groups; chips All 41 / Sales 12 / Community 29 (sum ✓); Sales filter → 12 sales-only events; Community → 29; product chip deep-link → product page (physical click verified — earlier miss was a sticky-header overlap from scrollIntoView default, not a bug); Overview "Recent activity" card: 5 events + View all → Activity tab; dark mode readable (all 41 bubbles tinted, rail present); mobile 390×844 scrollWidth=390; zero page/console errors; lint exit 0; tsc --noEmit clean.
- VLM ratings: light timeline 9/10, dark 9.5/10, mobile 9/10, overview card recreated accurately by VLM (renders as designed).

## Deviations / notes
- **payment_failed has no seed data**: the pristine seed contains ZERO FAILED Invoice rows (David's past-due story uses dunningAttempts + a notification, not a FAILED invoice). The aggregation path is implemented per spec; no payment_failed events appear because none exist in the DB. Did NOT mutate the pristine DB to fabricate one.
- Payout events use `paidAt ?? createdAt` as `at` (more truthful for "Payout paid"); title lowercases status ("Payout paid — $340").
- Invoice has no Product relation (scalar productId only) — route builds a title map (same pattern as /api/creator/orders).
- Overview card: replaced the existing analytics-fed "Recent activity" card (invoice.paid/failed + subscription.created only) with the richer activity-feed card at the same grid position (lg:col-span-2 next to Top products) instead of adding a duplicate card. `analytics.recentActivity` remains in the API, now unused by the UI.
- Dev server died once during final checks (reaped session, per the known sandbox issue) — relaunched with `python3 .zscripts/launch-dev.py`; worker (port 3040) was never touched and kept ticking.

## State left behind
- App 200 on :3000, worker running, clock Live, DB pristine (business data unchanged — verified counts identical before/after; only the worker's own WorkerRun rows accrue).
- agent-browser session `c3` left on Marcus → Creator Studio → Activity tab.
