/* Seed: Vendly marketplace demo data with ~90 days of billing history. */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DAY = 86400000;
const now = () => new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

let invoiceCounter = 1000;
async function nextInv() {
  return `INV-${++invoiceCounter}`;
}

async function main() {
  console.log("🌱 Seeding Vendly marketplace…");

  // wipe
  await db.webhookDelivery.deleteMany();
  await db.webhookEndpoint.deleteMany();
  await db.downloadToken.deleteMany();
  await db.accessGrant.deleteMany();
  await db.licenseKey.deleteMany();
  await db.invoice.deleteMany();
  await db.subscription.deleteMany();
  // bundle rows reference plans/products/users — clear them (in this order)
  // before the catalog is wiped
  await db.bundlePurchase.deleteMany();
  await db.bundleItem.deleteMany();
  await db.bundle.deleteMany();
  await db.paymentMethod.deleteMany();
  await db.review.deleteMany();
  await db.digitalAsset.deleteMany();
  await db.plan.deleteMany();
  await db.promoRedemption.deleteMany();
  await db.promoCode.deleteMany();
  await db.wishlistItem.deleteMany();
  await db.notification.deleteMany();
  await db.payout.deleteMany();
  await db.affiliateCommission.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliateProgram.deleteMany();
  await db.giveawayEntry.deleteMany();
  await db.giveaway.deleteMany();
  await db.questionVote.deleteMany();
  await db.answer.deleteMany();
  await db.question.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
  await db.systemClock.deleteMany();
  await db.advisoryLock.deleteMany(); // release any stale engine/checkout locks
  await db.counter.deleteMany(); // reset the atomic invoice-number counter
  await db.whopEvent.deleteMany(); // clear webhook event dedupe history
  await db.auditLog.deleteMany(); // clear the money-event audit trail

  // ============ Users ============
  const bob = await db.user.create({
    data: {
      email: "marcus@whoply.io",
      name: "Marcus Chen",
      role: "CREATOR",
      bio: "Ex-Wall Street quant. I run trading communities and publish SaaS playbooks.",
      avatarColor: "emerald",
      discordHandle: "marcus.eth",
      telegramHandle: "@marcusquant",
      isDemo: true,
      createdAt: daysAgo(400),
    },
  });
  const carol = await db.user.create({
    data: {
      email: "aisha@whoply.io",
      name: "Aisha Rahman",
      role: "CREATOR",
      bio: "Fitness coach & design educator. 60k community members.",
      avatarColor: "rose",
      discordHandle: "aisha.fit",
      telegramHandle: "@aishafit",
      isDemo: true,
      createdAt: daysAgo(350),
    },
  });

  const mkCustomer = (email: string, name: string, color: string, discord?: string, telegram?: string) =>
    db.user.create({
      data: { email, name, role: "CUSTOMER", avatarColor: color, discordHandle: discord, telegramHandle: telegram, isDemo: true, createdAt: daysAgo(200) },
    });

  const alice = await mkCustomer("alex@demo.io", "Alex Rivera", "violet", "alexrivera", "@alexrivera");
  const dave = await mkCustomer("david@demo.io", "David Kim", "amber", "davidkim");
  const eve = await mkCustomer("emma@demo.io", "Emma Sokolov", "cyan", undefined, "@emmasok");
  const frank = await mkCustomer("farid@demo.io", "Farid Haddad", "lime", "farid.h");
  const grace = await mkCustomer("gina@demo.io", "Gina Park", "orange", "ginapark");
  const hank = await mkCustomer("hugo@demo.io", "Hugo Laurent", "teal", undefined, "@hugol");
  const ivy = await mkCustomer("iris@demo.io", "Iris Nakamura", "fuchsia", "irisn");

  // ============ Products ============
  const tradeSignals = await db.product.create({
    data: {
      creatorId: bob.id,
      slug: "trade-signals-pro",
      title: "Trade Signals Pro",
      tagline: "Daily algo-trading signals with a 74% win rate",
      description:
        "Join 2,800+ traders receiving real-time signals across forex, indices and commodities. Membership includes live London/NY session breakdowns, a quant-verified backtest library, weekly market structure reports, and priority Q&A with our desk.\n\nAccess is provisioned instantly through our Discord bot — your role is assigned automatically at checkout and revoked if your subscription lapses.",
      category: "TRADING",
      coverTheme: "emerald",
      accessType: "DISCORD",
      featured: true,
      membersCount: 2843,
      rating: 4.8,
      reviewCount: 412,
      discordRoleName: "@VIP Trader",
      createdAt: daysAgo(380),
    },
  });
  await db.plan.createMany({
    data: [
      { productId: tradeSignals.id, name: "Starter", description: "Core signals channel", priceCents: 1900, interval: "month", sortOrder: 1, features: JSON.stringify(["3 signals per day", "Community chat", "Weekly outlook report"]) },
      { productId: tradeSignals.id, name: "Pro", description: "Full desk access", priceCents: 4900, interval: "month", trialDays: 3, badge: "Most Popular", sortOrder: 2, features: JSON.stringify(["Unlimited real-time signals", "Live session breakdowns", "Backtest library (200+ strategies)", "Priority Q&A with the desk"]) },
      { productId: tradeSignals.id, name: "Elite", description: "1:1 mentorship", priceCents: 9900, interval: "month", sortOrder: 3, features: JSON.stringify(["Everything in Pro", "Monthly 1:1 mentorship call", "Position sizing toolkit", "Private elite lounge"]) },
      { productId: tradeSignals.id, name: "Elite Annual", description: "Save 2 months", priceCents: 99000, interval: "year", badge: "Best Value", sortOrder: 4, features: JSON.stringify(["Everything in Elite", "2 months free", "Annual performance review"]) },
    ],
  });

  const saasBlueprint = await db.product.create({
    data: {
      creatorId: bob.id,
      slug: "saas-growth-blueprint",
      title: "SaaS Growth Blueprint",
      tagline: "The licensed playbook that took 3 products to $10M ARR",
      description:
        "A licensed, continuously-updated operating system for SaaS founders. Every purchase is provisioned with a unique license key (3 device activations) and unlocks the secure asset vault containing playbooks, board decks, and financial models.\n\nNew chapters ship every month — your subscription keeps the license and downloads active.",
      category: "SAAS",
      coverTheme: "violet",
      accessType: "LICENSE,FILE",
      featured: true,
      membersCount: 1290,
      rating: 4.9,
      reviewCount: 268,
      createdAt: daysAgo(300),
    },
  });
  await db.plan.createMany({
    data: [
      { productId: saasBlueprint.id, name: "Founder", description: "Monthly access", priceCents: 2900, interval: "month", sortOrder: 1, features: JSON.stringify(["Full blueprint library", "License key (3 devices)", "Monthly chapter drops"]) },
      { productId: saasBlueprint.id, name: "Studio", description: "Team license", priceCents: 7900, interval: "month", sortOrder: 2, badge: "Most Popular", features: JSON.stringify(["Everything in Founder", "10 device activations", "Financial model pack", "Quarterly office hours"]) },
      { productId: saasBlueprint.id, name: "Annual", description: "Save 17%", priceCents: 29000, interval: "year", sortOrder: 3, features: JSON.stringify(["Everything in Founder", "Lifetime chapter archive", "Priority support"]) },
    ],
  });

  const cryptoAlpha = await db.product.create({
    data: {
      creatorId: bob.id,
      slug: "crypto-alpha-group",
      title: "Crypto Alpha Group",
      tagline: "On-chain intelligence & degen calls, paid in crypto if you like",
      description:
        "An invite-only group of 950 on-chain analysts. Membership grants a Discord role plus an API license key for our analytics dashboard. Pay with card, PayPal, or crypto — recurring billing supported on all three gateways.\n\nWe publish wallet-flow reports, launchpad reviews and MEV alerts 24/7.",
      category: "CRYPTO",
      coverTheme: "amber",
      accessType: "DISCORD,LICENSE",
      featured: true,
      membersCount: 948,
      rating: 4.6,
      reviewCount: 190,
      discordRoleName: "@Alpha Whale",
      createdAt: daysAgo(240),
    },
  });
  await db.plan.createMany({
    data: [
      { productId: cryptoAlpha.id, name: "Analyst", description: "Monthly", priceCents: 9900, interval: "month", trialDays: 7, sortOrder: 1, features: JSON.stringify(["Alpha feed", "Discord role", "Analytics license key"]) },
      { productId: cryptoAlpha.id, name: "Whale", description: "Annual", priceCents: 99900, interval: "year", badge: "Best Value", sortOrder: 2, features: JSON.stringify(["Everything in Analyst", "Private whale wallet tracking", "Quarterly alpha review call"]) },
    ],
  });

  const fitcore = await db.product.create({
    data: {
      creatorId: carol.id,
      slug: "fitcore-coaching",
      title: "FitCore Coaching",
      tagline: "Adaptive training programs delivered to your Telegram",
      description:
        "Your coach in your pocket. FitCore pushes adaptive workout plans, nutrition targets and daily check-ins through a private Telegram channel. The bot assigns your member channel automatically after checkout — no invite links to juggle.",
      category: "FITNESS",
      coverTheme: "rose",
      accessType: "TELEGRAM",
      membersCount: 1655,
      rating: 4.7,
      reviewCount: 322,
      telegramChannel: "fitcore-members",
      createdAt: daysAgo(280),
    },
  });
  await db.plan.createMany({
    data: [
      { productId: fitcore.id, name: "Solo", description: "Self-guided", priceCents: 1500, interval: "month", sortOrder: 1, features: JSON.stringify(["Adaptive workout plans", "Nutrition targets", "Telegram community"]) },
      { productId: fitcore.id, name: "Coached", description: "1:1 support", priceCents: 3900, interval: "month", badge: "Most Popular", sortOrder: 2, features: JSON.stringify(["Everything in Solo", "Weekly coach check-in", "Form-review video uploads", "Custom meal plans"]) },
    ],
  });

  const designVault = await db.product.create({
    data: {
      creatorId: carol.id,
      slug: "design-vault",
      title: "Design Vault",
      tagline: "Premium UI kits, icons & mockups — new drops weekly",
      description:
        "A curated vault of production-ready design assets. Secure tokenized downloads protect every file; access is tied to your active membership. Includes Figma source files, icon families and device mockup bundles.",
      category: "DESIGN",
      coverTheme: "cyan",
      accessType: "FILE",
      membersCount: 2310,
      rating: 4.9,
      reviewCount: 511,
      createdAt: daysAgo(200),
    },
  });
  await db.plan.createMany({
    data: [
      { productId: designVault.id, name: "Personal", description: "Monthly vault access", priceCents: 1200, interval: "month", sortOrder: 1, features: JSON.stringify(["All current assets", "Weekly drops", "Personal license"]) },
      { productId: designVault.id, name: "Studio", description: "Team license", priceCents: 4900, interval: "month", sortOrder: 2, features: JSON.stringify(["Everything in Personal", "Unlimited team seats", "Commercial license", "Source Figma files"]) },
    ],
  });

  const streamAcademy = await db.product.create({
    data: {
      creatorId: carol.id,
      slug: "stream-mastery-academy",
      title: "Stream Mastery Academy",
      tagline: "From 0 to 10k viewers — live streaming school",
      description:
        "A structured curriculum for serious streamers: overlays, monetization, community psychology and algorithm hacks. Includes a Discord role for cohort channels and a graduation license certificate.",
      category: "EDUCATION",
      coverTheme: "lime",
      accessType: "DISCORD",
      membersCount: 780,
      rating: 4.5,
      reviewCount: 96,
      discordRoleName: "@Cohort 12",
      createdAt: daysAgo(120),
    },
  });
  await db.plan.createMany({
    data: [
      { productId: streamAcademy.id, name: "Cohort", description: "8-week program", priceCents: 2500, interval: "month", sortOrder: 1, features: JSON.stringify(["8-week live curriculum", "Cohort Discord role", "Assignment reviews"]) },
    ],
  });

  // ============ Digital assets ============
  const assets = [
    { productId: saasBlueprint.id, name: "Growth Playbook v4", fileName: "growth-playbook-v4.md", sizeBytes: 482000, version: "4.2", content: "# SaaS Growth Playbook v4\n\n## Chapter 1 — Positioning\nYour positioning statement must answer three questions in under 140 characters...\n\n## Chapter 2 — Activation\nInstrument the aha-moment funnel. Target D7 retention > 40%.\n\n## Chapter 3 — Pricing\nRun quarterly willingness-to-pay surveys. Anchor on value metrics, not seats.\n\n(11 more chapters in the full file)\n" },
    { productId: saasBlueprint.id, name: "Financial Model Pack", fileName: "financial-models.md", sizeBytes: 156000, version: "2.0", content: "# Financial Model Pack\n\n## ARR waterfall\nQ1 opening ARR: $1.2M ... new $180k ... churned -$42k ...\n\n## Cohort LTV model\nMedian payback: 7.2 months. LTV/CAC: 4.1x.\n\n## Headcount plan\nRamping plan attached per function.\n" },
    { productId: saasBlueprint.id, name: "Board Deck Template", fileName: "board-deck-template.md", sizeBytes: 98000, version: "1.6", requiresLicense: true, content: "# Board Deck Template\n\nSlide 1: North star metric + trend\nSlide 2: ARR waterfall\nSlide 3: Retention cohorts heatmap\nSlide 4: Cash runway scenarios\n..." },
    { productId: designVault.id, name: "Icon Pack Vol.3", fileName: "icon-pack-vol3.md", sizeBytes: 2400000, version: "3.1", content: "# Icon Pack Vol.3\n\n1,240 pixel-perfect icons across 5 families (line, duotone, solid, glyph, micro).\nSVG + Figma sources included. License: personal/commercial per plan.\n" },
    { productId: designVault.id, name: "Dashboard UI Kit", fileName: "dashboard-ui-kit.md", sizeBytes: 5100000, version: "2.4", content: "# Dashboard UI Kit\n\n64 dashboard screens, 280 components, auto-layout everywhere.\nDark + light themes, design tokens for Tailwind.\n" },
    { productId: designVault.id, name: "Device Mockup Bundle", fileName: "device-mockups.md", sizeBytes: 3300000, version: "1.9", requiresLicense: true, content: "# Device Mockup Bundle\n\nPhotorealistic mockups: iPhone 16, Pixel 9, MacBook M4, iMac, iPad Pro.\nSmart-object ready, 6k resolution.\n" },
    { productId: cryptoAlpha.id, name: "On-Chain Analytics Guide", fileName: "onchain-analytics-guide.md", sizeBytes: 210000, version: "1.3", requiresLicense: true, content: "# On-Chain Analytics Guide\n\n## Wallet-flow analysis\nTrack smart-money accumulation with our 6-step framework...\n\n## MEV alerting\nConfigure the license-key dashboard webhook...\n" },
  ];
  for (const a of assets) {
    await db.digitalAsset.create({ data: a });
  }

  // ============ Reviews ============
  const reviews: Array<[string, string, number, string]> = [
    [tradeSignals.id, "Tomás R.", 5, "Win rate is real. Made back the subscription in two trades."],
    [tradeSignals.id, "Priya S.", 4, "Great signals, would love more forex coverage in the Elite plan."],
    [tradeSignals.id, "Kenji M.", 5, "The London session breakdown alone is worth 10x the price."],
    [tradeSignals.id, "Sofia L.", 4, "Solid desk, transparent performance logs."],
    [saasBlueprint.id, "Nadia B.", 5, "The financial model pack saved our board meeting. Absurd value."],
    [saasBlueprint.id, "Ravi P.", 5, "Chapter on pricing alone changed our roadmap."],
    [saasBlueprint.id, "Ellie W.", 4, "Very dense. Take notes."],
    [cryptoAlpha.id, "Dmitri K.", 5, "Wallet-flow reports are unmatched. Whale plan paid for itself."],
    [cryptoAlpha.id, "Chen L.", 4, "Good alpha, telegram alerts sometimes lag."],
    [fitcore.id, "Maya J.", 5, "Coach Aisha rebuilt my relationship with training. 12kg down."],
    [fitcore.id, "Omar D.", 4, "Check-ins keep me honest. Love the Telegram delivery."],
    [designVault.id, "Lina F.", 5, "The dashboard kit is the best $12/mo in design."],
    [designVault.id, "Jonas A.", 5, "Weekly drops are consistently gorgeous."],
    [streamAcademy.id, "Kira N.", 4, "Went from 12 to 900 average viewers in one cohort."],
  ];
  let rDaysAgo = 60;
  for (const [pid, author, rating, comment] of reviews) {
    await db.review.create({
      data: { productId: pid, userId: alice.id, authorName: author, rating, comment, createdAt: daysAgo((rDaysAgo -= 3) + 1) },
    });
  }

  // ============ Payment methods ============
  const pmAliceCard = await db.paymentMethod.create({
    data: { userId: alice.id, type: "CARD", gateway: "STRIPE", brand: "Visa", last4: "4242", expMonth: 12, expYear: 2028, isDefault: true },
  });
  const pmAlicePaypal = await db.paymentMethod.create({
    data: { userId: alice.id, type: "PAYPAL", gateway: "PAYPAL", email: "alex@demo.io" },
  });
  const pmAliceCrypto = await db.paymentMethod.create({
    data: { userId: alice.id, type: "CRYPTO", gateway: "CRYPTO", walletAddress: "0x7aF3b21c9E4d5A60B8c7F1024e9dD3a5B6c8901F", chain: "ETH" },
  });
  const pmDaveCard = await db.paymentMethod.create({
    data: { userId: dave.id, type: "CARD", gateway: "STRIPE", brand: "Mastercard", last4: "0002", expMonth: 8, expYear: 2027, isDefault: true },
  });
  const pmEvePaypal = await db.paymentMethod.create({
    data: { userId: eve.id, type: "PAYPAL", gateway: "PAYPAL", email: "emma@demo.io", isDefault: true },
  });
  const pmFrankCrypto = await db.paymentMethod.create({
    data: { userId: frank.id, type: "CRYPTO", gateway: "CRYPTO", walletAddress: "0x9bB4c02a1F3d5E78A9c0B1d2E3f4A5b6C7d8E9f0", chain: "ETH", isDefault: true },
  });
  const pmGraceCard = await db.paymentMethod.create({
    data: { userId: grace.id, type: "CARD", gateway: "STRIPE", brand: "Amex", last4: "1005", expMonth: 3, expYear: 2029, isDefault: true },
  });
  const pmHankPaypal = await db.paymentMethod.create({
    data: { userId: hank.id, type: "PAYPAL", gateway: "PAYPAL", email: "hugo@demo.io", isDefault: true },
  });
  const pmIvyCard = await db.paymentMethod.create({
    data: { userId: ivy.id, type: "CARD", gateway: "STRIPE", brand: "Visa", last4: "1881", expMonth: 10, expYear: 2028, isDefault: true },
  });

  // ============ Subscriptions + invoices (90d history) ============
  const plans = {
    tspStarter: await db.plan.findFirst({ where: { productId: tradeSignals.id, name: "Starter" } }),
    tspPro: await db.plan.findFirst({ where: { productId: tradeSignals.id, name: "Pro" } }),
    tspElite: await db.plan.findFirst({ where: { productId: tradeSignals.id, name: "Elite" } }),
    tspEliteAnnual: await db.plan.findFirst({ where: { productId: tradeSignals.id, name: "Elite Annual" } }),
    sbpFounder: await db.plan.findFirst({ where: { productId: saasBlueprint.id, name: "Founder" } }),
    sbpAnnual: await db.plan.findFirst({ where: { productId: saasBlueprint.id, name: "Annual" } }),
    cagAnalyst: await db.plan.findFirst({ where: { productId: cryptoAlpha.id, name: "Analyst" } }),
    cagWhale: await db.plan.findFirst({ where: { productId: cryptoAlpha.id, name: "Whale" } }),
    fcSolo: await db.plan.findFirst({ where: { productId: fitcore.id, name: "Solo" } }),
    fcCoached: await db.plan.findFirst({ where: { productId: fitcore.id, name: "Coached" } }),
    dvPersonal: await db.plan.findFirst({ where: { productId: designVault.id, name: "Personal" } }),
    dvStudio: await db.plan.findFirst({ where: { productId: designVault.id, name: "Studio" } }),
    smaCohort: await db.plan.findFirst({ where: { productId: streamAcademy.id, name: "Cohort" } }),
  };
  if (Object.values(plans).some((p) => !p)) throw new Error("missing plans");

  async function seedSub(opts: {
    userId: string;
    plan: NonNullable<(typeof plans)["tspStarter"]>;
    gateway: string;
    pmId: string | null;
    startedDaysAgo: number;
    status: string;
    cancelAtPeriodEnd?: boolean;
    canceledDaysAgo?: number;
    dunningAttempts?: number;
    makeInvoices?: boolean;
  }) {
    const started = daysAgo(opts.startedDaysAgo);
    const interval = opts.plan.interval;
    const cyclesLived = opts.canceledDaysAgo != null ? Math.max(1, Math.round((opts.startedDaysAgo - opts.canceledDaysAgo) / (interval === "year" ? 365 : 30))) : Math.max(1, Math.floor(opts.startedDaysAgo / (interval === "year" ? 365 : 30)));
    const sub = await db.subscription.create({
      data: {
        userId: opts.userId,
        planId: opts.plan.id,
        productId: opts.plan.productId,
        status: opts.status,
        gateway: opts.gateway,
        paymentMethodId: opts.pmId,
        currentPeriodStart: daysAgo(Math.max(0, opts.startedDaysAgo - (cyclesLived - 1) * (interval === "year" ? 365 : 30))),
        currentPeriodEnd: opts.status === "CANCELED" ? (opts.canceledDaysAgo != null ? daysAgo(opts.canceledDaysAgo) : daysAgo(0)) : daysAhead(Math.max(1, (interval === "year" ? 365 : 30) - (opts.startedDaysAgo % (interval === "year" ? 365 : 30)))),
        cancelAtPeriodEnd: opts.cancelAtPeriodEnd ?? false,
        canceledAt: opts.canceledDaysAgo != null ? daysAgo(opts.canceledDaysAgo) : null,
        dunningAttempts: opts.dunningAttempts ?? 0,
        createdAt: started,
      },
    });
    if (opts.makeInvoices !== false) {
      for (let c = 0; c < cyclesLived; c++) {
        const invDate = daysAgo(Math.max(0, opts.startedDaysAgo - c * (interval === "year" ? 365 : 30)));
        await db.invoice.create({
          data: {
            number: await nextInv(),
            userId: opts.userId,
            subscriptionId: sub.id,
            productId: opts.plan.productId,
            description: `${opts.plan.name} (${interval}ly)`,
            amountCents: opts.plan.priceCents,
            status: "PAID",
            gateway: opts.gateway,
            periodStart: invDate,
            periodEnd: new Date(invDate.getTime() + (interval === "year" ? 365 : 30) * DAY),
            paidAt: invDate,
            createdAt: invDate,
          },
        });
      }
    }
    return sub;
  }

  // Alex (primary demo customer)
  await seedSub({ userId: alice.id, plan: plans.tspPro!, gateway: "STRIPE", pmId: pmAliceCard.id, startedDaysAgo: 75, status: "ACTIVE" });
  await seedSub({ userId: alice.id, plan: plans.sbpFounder!, gateway: "PAYPAL", pmId: pmAlicePaypal.id, startedDaysAgo: 42, status: "ACTIVE" });
  await seedSub({ userId: alice.id, plan: plans.dvPersonal!, gateway: "CRYPTO", pmId: pmAliceCrypto.id, startedDaysAgo: 55, status: "CANCELED", canceledDaysAgo: 20 });
  // Alex trialing crypto alpha (7-day trial, 4 days left) — great for the time machine
  const trialSub = await db.subscription.create({
    data: {
      userId: alice.id,
      planId: plans.cagAnalyst!.id,
      productId: cryptoAlpha.id,
      status: "TRIALING",
      gateway: "CRYPTO",
      paymentMethodId: pmAliceCrypto.id,
      currentPeriodStart: daysAgo(3),
      currentPeriodEnd: daysAhead(4),
      trialEndsAt: daysAhead(4),
      createdAt: daysAgo(3),
    },
  });

  // Dave — elite sub active; crypto alpha past-due (declining card 0002)
  await seedSub({ userId: dave.id, plan: plans.tspElite!, gateway: "STRIPE", pmId: pmDaveCard.id, startedDaysAgo: 60, status: "ACTIVE" });
  await seedSub({ userId: dave.id, plan: plans.cagAnalyst!, gateway: "STRIPE", pmId: pmDaveCard.id, startedDaysAgo: 35, status: "PAST_DUE", dunningAttempts: 2 });
  // Eve — fitcore active; trade starter churned
  await seedSub({ userId: eve.id, plan: plans.fcCoached!, gateway: "PAYPAL", pmId: pmEvePaypal.id, startedDaysAgo: 30, status: "ACTIVE" });
  await seedSub({ userId: eve.id, plan: plans.tspStarter!, gateway: "PAYPAL", pmId: pmEvePaypal.id, startedDaysAgo: 58, status: "CANCELED", canceledDaysAgo: 14 });
  // Frank — whale annual via crypto
  await seedSub({ userId: frank.id, plan: plans.cagWhale!, gateway: "CRYPTO", pmId: pmFrankCrypto.id, startedDaysAgo: 80, status: "ACTIVE" });
  // Grace — design vault + saas annual
  await seedSub({ userId: grace.id, plan: plans.dvStudio!, gateway: "STRIPE", pmId: pmGraceCard.id, startedDaysAgo: 50, status: "ACTIVE" });
  await seedSub({ userId: grace.id, plan: plans.sbpAnnual!, gateway: "STRIPE", pmId: pmGraceCard.id, startedDaysAgo: 70, status: "ACTIVE" });
  // Hank — trade pro via paypal, canceling at period end
  await seedSub({ userId: hank.id, plan: plans.tspPro!, gateway: "PAYPAL", pmId: pmHankPaypal.id, startedDaysAgo: 10, status: "ACTIVE", cancelAtPeriodEnd: true });
  // Iris — new customer cohort
  await seedSub({ userId: ivy.id, plan: plans.fcSolo!, gateway: "STRIPE", pmId: pmIvyCard.id, startedDaysAgo: 6, status: "ACTIVE" });
  await seedSub({ userId: ivy.id, plan: plans.dvPersonal!, gateway: "STRIPE", pmId: pmIvyCard.id, startedDaysAgo: 12, status: "ACTIVE" });
  await seedSub({ userId: ivy.id, plan: plans.smaCohort!, gateway: "STRIPE", pmId: pmIvyCard.id, startedDaysAgo: 25, status: "CANCELED", canceledDaysAgo: 5 });

  // ============ License keys ============
  await db.licenseKey.create({
    data: {
      key: "WHPL-7K2M-QX9R-4T8V",
      userId: alice.id,
      productId: saasBlueprint.id,
      subscriptionId: (await db.subscription.findFirst({ where: { userId: alice.id, productId: saasBlueprint.id } }))!.id,
      status: "ACTIVE",
      planName: "Founder",
      activations: 2,
      maxActivations: 3,
      activatedAt: daysAgo(42),
      lastUsedAt: daysAgo(2),
      createdAt: daysAgo(42),
    },
  });
  await db.licenseKey.create({
    data: {
      key: "WHPL-9X4K-2M7Q-8RT3",
      userId: dave.id,
      productId: cryptoAlpha.id,
      status: "ACTIVE",
      planName: "Analyst",
      activations: 1,
      maxActivations: 2,
      activatedAt: daysAgo(35),
      lastUsedAt: daysAgo(7),
      createdAt: daysAgo(35),
    },
  });
  await db.licenseKey.create({
    data: {
      key: "WHPL-3F6H-J5N8-P2W6",
      userId: frank.id,
      productId: cryptoAlpha.id,
      status: "ACTIVE",
      planName: "Whale",
      activations: 3,
      maxActivations: 5,
      activatedAt: daysAgo(80),
      lastUsedAt: daysAgo(1),
      createdAt: daysAgo(80),
    },
  });
  await db.licenseKey.create({
    data: {
      key: "WHPL-8C3V-M6Y2-K9D4",
      userId: alice.id,
      productId: cryptoAlpha.id,
      subscriptionId: trialSub.id,
      status: "ACTIVE",
      planName: "Analyst",
      activations: 0,
      createdAt: daysAgo(3),
    },
  });

  // ============ Access grants ============
  const grantData: Array<{ userId: string; productId: string; provider: string; role: string | null; daysAgoN: number; revokedDaysAgo?: number }> = [
    { userId: alice.id, productId: tradeSignals.id, provider: "DISCORD", role: "@VIP Trader", daysAgoN: 75 },
    { userId: alice.id, productId: saasBlueprint.id, provider: "LICENSE", role: null, daysAgoN: 42 },
    { userId: alice.id, productId: saasBlueprint.id, provider: "FILE", role: null, daysAgoN: 42 },
    { userId: alice.id, productId: designVault.id, provider: "FILE", role: null, daysAgoN: 55, revokedDaysAgo: 20 },
    { userId: alice.id, productId: cryptoAlpha.id, provider: "DISCORD", role: "@Alpha Whale", daysAgoN: 3 },
    { userId: alice.id, productId: cryptoAlpha.id, provider: "LICENSE", role: null, daysAgoN: 3 },
    { userId: dave.id, productId: tradeSignals.id, provider: "DISCORD", role: "@VIP Trader", daysAgoN: 60 },
    { userId: dave.id, productId: cryptoAlpha.id, provider: "DISCORD", role: "@Alpha Whale", daysAgoN: 35 },
    { userId: dave.id, productId: cryptoAlpha.id, provider: "LICENSE", role: null, daysAgoN: 35 },
    { userId: eve.id, productId: fitcore.id, provider: "TELEGRAM", role: "fitcore-members", daysAgoN: 30 },
    { userId: eve.id, productId: tradeSignals.id, provider: "DISCORD", role: "@VIP Trader", daysAgoN: 58, revokedDaysAgo: 14 },
    { userId: frank.id, productId: cryptoAlpha.id, provider: "DISCORD", role: "@Alpha Whale", daysAgoN: 80 },
    { userId: frank.id, productId: cryptoAlpha.id, provider: "LICENSE", role: null, daysAgoN: 80 },
    { userId: grace.id, productId: designVault.id, provider: "FILE", role: null, daysAgoN: 50 },
    { userId: grace.id, productId: saasBlueprint.id, provider: "LICENSE", role: null, daysAgoN: 70 },
    { userId: grace.id, productId: saasBlueprint.id, provider: "FILE", role: null, daysAgoN: 70 },
    { userId: hank.id, productId: tradeSignals.id, provider: "DISCORD", role: "@VIP Trader", daysAgoN: 10 },
    { userId: ivy.id, productId: fitcore.id, provider: "TELEGRAM", role: "fitcore-members", daysAgoN: 6 },
    { userId: ivy.id, productId: designVault.id, provider: "FILE", role: null, daysAgoN: 12 },
    { userId: ivy.id, productId: streamAcademy.id, provider: "DISCORD", role: "@Cohort 12", daysAgoN: 25, revokedDaysAgo: 5 },
  ];
  for (const g of grantData) {
    await db.accessGrant.create({
      data: {
        userId: g.userId,
        productId: g.productId,
        provider: g.provider,
        role: g.role,
        status: g.revokedDaysAgo != null ? "REVOKED" : "SYNCED",
        grantedAt: daysAgo(g.daysAgoN),
        revokedAt: g.revokedDaysAgo != null ? daysAgo(g.revokedDaysAgo) : null,
        createdAt: daysAgo(g.daysAgoN),
      },
    });
  }

  // ============ Webhook endpoints + deliveries ============
  const epDiscord = await db.webhookEndpoint.create({
    data: {
      creatorId: bob.id,
      name: "Discord Bot — Access Manager",
      provider: "DISCORD_BOT",
      url: "https://discord.com/api/webhooks/1178/trade-signals-bot",
      secret: "whsec_9f2a4c6e8b0d1f3a5c7e9b1d3f5a7c9e",
      events: JSON.stringify(["subscription.created", "subscription.canceled", "access.granted", "access.revoked", "license_key.created", "license_key.revoked"]),
      createdAt: daysAgo(370),
    },
  });
  const epZapier = await db.webhookEndpoint.create({
    data: {
      creatorId: bob.id,
      name: "CRM Sync (Zapier)",
      provider: "GENERIC",
      url: "https://hooks.zapier.com/hooks/catch/12345/abcde/",
      secret: "whsec_1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e11",
      events: JSON.stringify(["invoice.paid", "invoice.payment_failed", "subscription.past_due"]),
      createdAt: daysAgo(200),
    },
  });
  const epTelegram = await db.webhookEndpoint.create({
    data: {
      creatorId: carol.id,
      name: "Telegram Bot — FitCore",
      provider: "TELEGRAM_BOT",
      url: "https://api.telegram.org/bot8839/sendMessage",
      secret: "whsec_7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d",
      events: JSON.stringify(["subscription.created", "subscription.renewed", "access.granted", "access.revoked"]),
      createdAt: daysAgo(270),
    },
  });
  const epFail = await db.webhookEndpoint.create({
    data: {
      creatorId: carol.id,
      name: "Legacy CRM (flaky)",
      provider: "GENERIC",
      url: "https://legacy-crm.example.com/fail/webhook",
      secret: "whsec_deadbeefcafe",
      events: JSON.stringify(["invoice.paid"]),
      isActive: false,
      createdAt: daysAgo(150),
    },
  });

  const deliveries: Array<{ ep: string; type: string; ok: boolean; daysAgoN: number; data: Record<string, unknown> }> = [
    { ep: epDiscord.id, type: "access.granted", ok: true, daysAgoN: 3, data: { provider: "DISCORD", role: "@VIP Trader", user: { name: "Alex Rivera" }, product: { title: "Trade Signals Pro" } } },
    { ep: epDiscord.id, type: "license_key.created", ok: true, daysAgoN: 3, data: { key: "WHPL-8C3V-M6Y2-K9D4", product: { title: "Crypto Alpha Group" } } },
    { ep: epZapier.id, type: "invoice.paid", ok: true, daysAgoN: 5, data: { amount: "$49.00", product: { title: "Trade Signals Pro" } } },
    { ep: epDiscord.id, type: "subscription.canceled", ok: true, daysAgoN: 14, data: { product: { title: "Trade Signals Pro" }, reason: "at_period_end" } },
    { ep: epZapier.id, type: "subscription.past_due", ok: true, daysAgoN: 8, data: { product: { title: "Crypto Alpha Group" }, attempt: 2 } },
    { ep: epZapier.id, type: "invoice.payment_failed", ok: true, daysAgoN: 8, data: { error: "Card declined by issuer.", attempt: 2 } },
    { ep: epTelegram.id, type: "access.granted", ok: true, daysAgoN: 6, data: { provider: "TELEGRAM", channel: "fitcore-members", user: { name: "Iris Nakamura" } } },
    { ep: epTelegram.id, type: "subscription.renewed", ok: true, daysAgoN: 2, data: { amount: "$39.00", product: { title: "FitCore Coaching" } } },
    { ep: epFail.id, type: "invoice.paid", ok: false, daysAgoN: 30, data: { amount: "$12.00", note: "legacy endpoint always 500s" } },
    { ep: epDiscord.id, type: "access.revoked", ok: true, daysAgoN: 20, data: { provider: "FILE", product: { title: "Design Vault" } } },
  ];
  for (const d of deliveries) {
    await db.webhookDelivery.create({
      data: {
        endpointId: d.ep,
        eventType: d.type,
        payload: JSON.stringify({ id: `evt_seed_${Math.random().toString(36).slice(2, 10)}`, type: d.type, created: daysAgo(d.daysAgoN).toISOString(), data: d.data }, null, 2),
        status: d.ok ? "DELIVERED" : "FAILED",
        attempts: d.ok ? 1 : 3,
        responseCode: d.ok ? 200 : 500,
        signature: "sha256=seeded",
        createdAt: daysAgo(d.daysAgoN),
        deliveredAt: d.ok ? daysAgo(d.daysAgoN) : null,
      },
    });
  }

  await db.systemClock.create({ data: { id: "main", simulatedNow: null, label: "Live" } });

  // ============ Promo codes ============
  const promoWelcome = await db.promoCode.create({
    data: {
      creatorId: bob.id,
      code: "WELCOME20",
      kind: "PERCENT",
      value: 20,
      durationMonths: 3,
      maxRedemptions: 0,
      createdAt: daysAgo(60),
    },
  });
  const promoLaunch = await db.promoCode.create({
    data: {
      creatorId: bob.id,
      productId: tradeSignals.id,
      code: "LAUNCH10",
      kind: "FIXED",
      value: 1000,
      durationMonths: 1,
      maxRedemptions: 100,
      expiresAt: daysAhead(30),
      createdAt: daysAgo(45),
    },
  });
  const promoSummer = await db.promoCode.create({
    data: {
      creatorId: bob.id,
      code: "SUMMER22",
      kind: "PERCENT",
      value: 30,
      durationMonths: 1,
      maxRedemptions: 50,
      expiresAt: daysAgo(10),
      active: false,
      createdAt: daysAgo(120),
    },
  });
  const promoFit = await db.promoCode.create({
    data: {
      creatorId: carol.id,
      productId: fitcore.id,
      code: "FITFAM15",
      kind: "PERCENT",
      value: 15,
      durationMonths: 2,
      createdAt: daysAgo(30),
    },
  });

  // Historical redemptions so creator stats have real numbers to show.
  const subsForRedemption = await db.subscription.findMany({
    where: { status: { in: ["ACTIVE", "CANCELED"] } },
    select: { id: true, userId: true },
    take: 8,
  });
  async function seedRedemptions(
    promoId: string,
    count: number,
    discountCents: number,
    oldestDaysAgo: number
  ) {
    for (let i = 0; i < count; i++) {
      const sub = subsForRedemption[i % Math.max(1, subsForRedemption.length)];
      if (!sub) break;
      await db.promoRedemption.create({
        data: {
          promoId,
          userId: sub.userId,
          subscriptionId: sub.id,
          invoiceId: null,
          discountCents,
          createdAt: daysAgo(oldestDaysAgo - Math.round((i / Math.max(1, count - 1)) * (oldestDaysAgo - 1))),
        },
      });
    }
    await db.promoCode.update({ where: { id: promoId }, data: { timesRedeemed: count } });
  }
  await seedRedemptions(promoLaunch.id, 41, 1000, 44);
  await seedRedemptions(promoSummer.id, 27, 1470, 118);
  await seedRedemptions(promoFit.id, 12, 585, 29);
  await seedRedemptions(promoWelcome.id, 6, 980, 58);

  // ============ Wishlists ============
  await db.wishlistItem.create({ data: { userId: alice.id, productId: fitcore.id, createdAt: daysAgo(9) } });
  await db.wishlistItem.create({ data: { userId: alice.id, productId: streamAcademy.id, createdAt: daysAgo(4) } });
  await db.wishlistItem.create({ data: { userId: dave.id, productId: saasBlueprint.id, createdAt: daysAgo(6) } });
  await db.wishlistItem.create({ data: { userId: grace.id, productId: tradeSignals.id, createdAt: daysAgo(12) } });
  await db.wishlistItem.create({ data: { userId: eve.id, productId: designVault.id, createdAt: daysAgo(2) } });

  // ============ Payouts ============
  await db.payout.create({
    data: { creatorId: bob.id, amountCents: 62000, feeCents: 1914, status: "PAID", method: "BANK", createdAt: daysAgo(25), paidAt: daysAgo(22) },
  });
  await db.payout.create({
    data: { creatorId: bob.id, amountCents: 34000, feeCents: 1050, status: "PAID", method: "BANK", createdAt: daysAgo(12), paidAt: daysAgo(9) },
  });
  await db.payout.create({
    data: { creatorId: carol.id, amountCents: 4200, feeCents: 130, status: "PAID", method: "PAYPAL", createdAt: daysAgo(8), paidAt: daysAgo(6) },
  });

  // ============ Notifications ============
  const notif = (userId: string, type: string, title: string, body: string | null, icon: string, read: boolean, ago: number) =>
    db.notification.create({ data: { userId, type, title, body, icon, read, createdAt: daysAgo(ago) } });

  // Alex — the buyer story
  await notif(alice.id, "invoice_paid", "Payment received — INV-1028 · $49.00", "Trade Signals Pro — Pro · renewal charged", "receipt", true, 2.1);
  await notif(alice.id, "invoice_paid", "Payment received — INV-1013 · $79.00", "SaaS Growth Blueprint — Founder · renewal charged", "receipt", true, 9);
  await notif(alice.id, "license_created", "License key provisioned — Crypto Alpha Group", "Your key is ready in My Hub → Licenses. Activate it on up to 3 devices.", "key", true, 34);
  await notif(alice.id, "subscription_canceled", "Membership ended — Design Vault", "Your subscription reached its period end and was canceled as requested.", "x-circle", true, 20);
  await notif(alice.id, "invoice_paid", "Payment received — INV-1031 · $49.00", "Trade Signals Pro — Pro · renewal charged", "receipt", false, 0.2);

  // David — the dunning story
  await notif(dave.id, "payment_failed", "Payment failed — Crypto Alpha Group", "Card declined by issuer. · retry #2 · we'll retry on the next run", "alert", false, 0.4);

  // Marcus — the creator story
  await notif(bob.id, "subscription_created", "New subscriber — Trade Signals Pro", "Pro · $49.00 · Stripe", "user-plus", false, 0.1);
  await notif(bob.id, "promo_redeemed", "Promo LAUNCH10 redeemed", "Trade Signals Pro — Pro · −$10.00 applied", "tag", false, 0.3);
  await notif(bob.id, "review_new", "New ★★★★★ review — Trade Signals Pro", "Signals have been spot-on for 3 months straight... — Gina Park", "star", false, 1.2);
  await notif(bob.id, "payout_paid", "Payout of $340.00 sent", "Bank transfer completed after the settlement window.", "bank", true, 9);

  // Aisha — the creator story
  await notif(carol.id, "subscription_created", "New subscriber — FitCore Coaching", "Coached · $39.00 · Stripe", "user-plus", false, 0.7);
  await notif(carol.id, "review_new", "New ★★★★☆ review — FitCore Coaching", "“The coached plan is worth every penny…” · Emma Sokolov", "star", true, 3.4);

  // ============ Affiliate programs ============
  const progTsp = await db.affiliateProgram.create({
    data: { productId: tradeSignals.id, creatorId: bob.id, commissionBps: 3000, createdAt: daysAgo(80) },
  });
  const progSbp = await db.affiliateProgram.create({
    data: { productId: saasBlueprint.id, creatorId: bob.id, commissionBps: 2500, createdAt: daysAgo(50) },
  });
  const progFc = await db.affiliateProgram.create({
    data: { productId: fitcore.id, creatorId: carol.id, commissionBps: 2000, createdAt: daysAgo(35) },
  });

  // ============ Affiliate links ============
  const linkAlex = await db.affiliateLink.create({
    data: { code: "alex", userId: alice.id, programId: progTsp.id, clicks: 184, conversions: 6, createdAt: daysAgo(70) },
  });
  const linkGina = await db.affiliateLink.create({
    data: { code: "gina", userId: grace.id, programId: progTsp.id, clicks: 42, conversions: 2, createdAt: daysAgo(38) },
  });
  const linkEmma = await db.affiliateLink.create({
    data: { code: "emma", userId: eve.id, programId: progFc.id, clicks: 67, conversions: 1, createdAt: daysAgo(30) },
  });
  const linkDave = await db.affiliateLink.create({
    data: { code: "dave", userId: dave.id, programId: progSbp.id, clicks: 12, conversions: 0, createdAt: daysAgo(14) },
  });

  // ============ Affiliate commissions ============
  // Alex referred 6 conversions on Trade Signals Pro Pro ($49 → 30% = $14.70)
  const mkCommission = (linkId: string, affiliateId: string, creatorId: string, productId: string, subscriptionId: string, cents: number, status: string, ago: number) =>
    db.affiliateCommission.create({
      data: {
        linkId, affiliateId, creatorId, productId, subscriptionId,
        amountCents: cents,
        status,
        createdAt: daysAgo(ago),
        paidAt: status === "PAID" ? daysAgo(Math.max(0, ago - 2)) : null,
      },
    });

  const subsAll = await db.subscription.findMany({ select: { id: true, userId: true, productId: true } });
  const aliceSubIds = subsAll.filter((x) => x.userId === alice.id).map((x) => x.id);
  // 5 of Alex's 6 referrals came from other seeded subscribers (Hugo, Iris, Farid…)
  const referredSubs = subsAll.filter((x) => x.productId === tradeSignals.id && x.userId !== alice.id).slice(0, 5);
  await mkCommission(linkAlex.id, alice.id, bob.id, tradeSignals.id, referredSubs[0]?.id ?? aliceSubIds[0]!, 1470, "PAID", 55);
  await mkCommission(linkAlex.id, alice.id, bob.id, tradeSignals.id, referredSubs[1]?.id ?? aliceSubIds[0]!, 4410, "PAID", 41); // Elite annual referral ($147 × 30%)
  await mkCommission(linkAlex.id, alice.id, bob.id, tradeSignals.id, referredSubs[2]?.id ?? aliceSubIds[0]!, 1470, "PAID", 26);
  await mkCommission(linkAlex.id, alice.id, bob.id, tradeSignals.id, referredSubs[3]?.id ?? aliceSubIds[0]!, 1470, "PAID", 12);
  await mkCommission(linkAlex.id, alice.id, bob.id, tradeSignals.id, referredSubs[4]?.id ?? aliceSubIds[0]!, 1470, "PENDING", 3);
  await mkCommission(linkGina.id, grace.id, bob.id, tradeSignals.id, referredSubs[0]?.id ?? aliceSubIds[0]!, 1470, "PAID", 31);
  await mkCommission(linkGina.id, grace.id, bob.id, tradeSignals.id, referredSubs[1]?.id ?? aliceSubIds[0]!, 1470, "PENDING", 5);
  await mkCommission(linkEmma.id, eve.id, carol.id, fitcore.id, subsAll.find((x) => x.productId === fitcore.id)?.id ?? aliceSubIds[0]!, 780, "PAID", 21); // Coached $39 × 20%

  await notif(alice.id, "affiliate_earned", "Referral commission — $14.70 pending", "Someone joined Trade Signals Pro through your link alex. It settles on the next billing run.", "tag", false, 3);
  await notif(bob.id, "affiliate_joined", "New affiliate — Gina Park", "They're now promoting Trade Signals Pro for 30% per referred first invoice.", "user-plus", true, 38);

  // ============ Giveaways & drops ============
  const mkEntry = (giveawayId: string, userId: string, entries: number, won: boolean, ago: number) =>
    db.giveawayEntry.create({
      data: { giveawayId, userId, entries, won, createdAt: daysAgo(ago) },
    });

  // LIVE drop #1 — Marcus promotes Trade Signals Pro (Alex deliberately NOT
  // entered so the demo user can enter live)
  const gTsp = await db.giveaway.create({
    data: {
      creatorId: bob.id,
      productId: tradeSignals.id,
      title: "1-Year Elite Membership Giveaway",
      description:
        "Two lucky winners get a full year of Elite — live session breakdowns, the complete backtest library and priority desk Q&A. Winners are drawn automatically when the timer hits zero.",
      prize: "1-year Trade Signals Pro Elite membership + 1-on-1 strategy session",
      prizeValueCents: 58800,
      coverTheme: "emerald",
      status: "LIVE",
      endsAt: daysAhead(6),
      winnerCount: 2,
      memberBonus: 3,
      createdAt: daysAgo(9),
    },
  });
  // members (dave Elite, hank Pro) get the +3 member bonus
  await mkEntry(gTsp.id, dave.id, 4, false, 8);
  await mkEntry(gTsp.id, eve.id, 1, false, 7);
  await mkEntry(gTsp.id, grace.id, 1, false, 6);
  await mkEntry(gTsp.id, hank.id, 4, false, 4);
  await mkEntry(gTsp.id, ivy.id, 1, false, 2);

  // LIVE drop #2 — Aisha promotes Design Vault (Alex entered with 1 entry —
  // his Personal sub lapsed, so no member bonus; grace/ivy carry 3 each)
  const gDv = await db.giveaway.create({
    data: {
      creatorId: carol.id,
      productId: designVault.id,
      title: "Lifetime Design Vault Pass",
      description:
        "One winner takes the entire vault — every UI kit, icon pack and mockup, for life — plus a seat at next month's live Figma masterclass.",
      prize: "Design Vault lifetime access + live Figma masterclass seat",
      prizeValueCents: 24900,
      coverTheme: "violet",
      status: "LIVE",
      endsAt: daysAhead(2),
      winnerCount: 1,
      memberBonus: 2,
      createdAt: daysAgo(12),
    },
  });
  await mkEntry(gDv.id, alice.id, 1, false, 11);
  await mkEntry(gDv.id, grace.id, 3, false, 9);
  await mkEntry(gDv.id, ivy.id, 3, false, 3);

  // ENDED drop — Marcus's Crypto Alpha hardware-wallet drop, drawn 5 days
  // ago; Hugo + Iris won, David/Farid had member-bonus odds
  const gLedger = await db.giveaway.create({
    data: {
      creatorId: bob.id,
      productId: cryptoAlpha.id,
      title: "Ledger Nano X Drop",
      description:
        "A cold-storage hardware wallet for three lucky degens. Winners drawn when the countdown ended — congrats to Hugo and Iris!",
      prize: "Ledger Nano X hardware wallet (sealed)",
      prizeValueCents: 14900,
      coverTheme: "amber",
      status: "ENDED",
      endsAt: daysAgo(5),
      winnerCount: 2,
      memberBonus: 3,
      drawnAt: daysAgo(5),
      createdAt: daysAgo(19),
    },
  });
  await mkEntry(gLedger.id, dave.id, 4, false, 18);
  await mkEntry(gLedger.id, frank.id, 4, false, 17);
  await mkEntry(gLedger.id, hank.id, 1, true, 15);
  await mkEntry(gLedger.id, eve.id, 1, false, 14);
  await mkEntry(gLedger.id, ivy.id, 1, true, 13);
  await mkEntry(gLedger.id, grace.id, 1, false, 12);

  await notif(hank.id, "giveaway_won", "You won — Ledger Nano X Drop 🎉", "Your prize: Ledger Nano X hardware wallet (sealed). The creator will be in touch with delivery details.", "gift", false, 5);
  await notif(ivy.id, "giveaway_won", "You won — Ledger Nano X Drop 🎉", "Your prize: Ledger Nano X hardware wallet (sealed). The creator will be in touch with delivery details.", "gift", true, 5);
  await notif(bob.id, "giveaway_ended", "Giveaway ended — Ledger Nano X Drop", "6 entries · 2 winners drawn · Crypto Alpha Group", "gift", true, 5);
  await notif(bob.id, "giveaway_entered", "New giveaway entry — 1-Year Elite Membership Giveaway", "Someone just entered your drop. (Trade Signals Pro)", "gift", false, 2);
  await notif(carol.id, "giveaway_entered", "New giveaway entry — Lifetime Design Vault Pass", "Someone just entered your drop. (Design Vault)", "gift", false, 3);

  // ============ Product Q&A ============
  const mkQuestion = (productId: string, authorId: string, body: string, status: string, ago: number) =>
    db.question.create({ data: { productId, authorId, body, status, createdAt: daysAgo(ago) } });
  const mkAnswer = (questionId: string, authorId: string, body: string, isCreator: boolean, ago: number) =>
    db.answer.create({ data: { questionId, authorId, body, isCreator, createdAt: daysAgo(ago) } });
  const mkVotes = async (questionId: string, voters: string[], qAgo: number) => {
    for (let i = 0; i < voters.length; i++) {
      await db.questionVote.create({ data: { questionId, userId: voters[i], createdAt: daysAgo(Math.max(0.1, qAgo - 1 - i * 0.4)) } });
    }
  };

  // Trade Signals Pro (Marcus) — the busiest Q&A board
  const qStopLoss = await mkQuestion(
    tradeSignals.id, dave.id,
    "Does the signal feed include stop-loss and take-profit levels, or do I need to calculate risk management myself?",
    "ANSWERED", 16,
  );
  await mkAnswer(qStopLoss.id, hank.id, "Pro includes both SL and TP on every signal, plus suggested position sizing by risk band. Starter gets the entry and the stop — targets land in the weekly report.", false, 15);
  await mkAnswer(qStopLoss.id, bob.id, "Every signal ships with a stop-loss, two take-profit targets and a suggested risk-per-trade band. Starter covers entries + stops; Pro adds the full target ladder and the position-sizing toolkit.", true, 14);
  await mkVotes(qStopLoss.id, [alice.id, eve.id, frank.id, grace.id, hank.id, ivy.id, bob.id, carol.id], 16);

  const qVolume = await mkQuestion(
    tradeSignals.id, eve.id,
    "How many signals per day does the Starter plan include compared to Pro? Considering upgrading but want to know the volume first.",
    "ANSWERED", 11,
  );
  await mkAnswer(qVolume.id, bob.id, "Starter is capped at 3 signals per day during the London session. Pro is unlimited across both sessions — on active days that's typically 8-12.", true, 10.75); // ~6h response
  await mkVotes(qVolume.id, [dave.id, frank.id, hank.id, grace.id, ivy.id], 11);

  const qStudent = await mkQuestion(
    tradeSignals.id, frank.id,
    "Is there a student discount for the monthly plans? Happy to verify with my university email.",
    "OPEN", 4,
  );
  await mkVotes(qStudent.id, [eve.id, grace.id, hank.id], 4);

  // SaaS Growth Blueprint (Marcus)
  const qLicense = await mkQuestion(
    saasBlueprint.id, alice.id,
    "Can I use the license key on two machines — my laptop and my desktop — or is it strictly one activation?",
    "ANSWERED", 14,
  );
  await mkAnswer(qLicense.id, bob.id, "The Founder license activates on up to 3 devices, so laptop + desktop is fine. Studio bumps it to 10 if you ever need team seats.", true, 12);
  await mkVotes(qLicense.id, [dave.id, eve.id, frank.id, grace.id, hank.id, ivy.id, carol.id], 14);

  const qSheets = await mkQuestion(
    saasBlueprint.id, hank.id,
    "Do the financial models in the vault work in Google Sheets, or are they Excel-only?",
    "OPEN", 9,
  );
  await mkAnswer(qSheets.id, dave.id, "I opened the ARR waterfall in Google Sheets — imports fine with minor formula tweaks. The cohort model uses Excel array formulas that don't translate.", false, 8);
  await mkVotes(qSheets.id, [eve.id, grace.id, ivy.id, dave.id], 9);

  // FitCore Coaching (Aisha)
  const qHome = await mkQuestion(
    fitcore.id, ivy.id,
    "Do the adaptive plans adjust for home workouts with minimal equipment, or do they assume a full gym setup?",
    "ANSWERED", 13,
  );
  await mkAnswer(qHome.id, carol.id, "The plans adapt to whatever equipment you list in onboarding — dumbbells and a bench is plenty. Every movement has a home variant with band substitutions.", true, 12.75); // ~6h response
  await mkVotes(qHome.id, [alice.id, bob.id, carol.id, dave.id, eve.id, frank.id, grace.id, hank.id], 13);

  const qVeg = await mkQuestion(
    fitcore.id, alice.id,
    "Is the nutrition guidance suitable for vegetarians? Mostly asking about the custom meal plans in the Coached tier.",
    "ANSWERED", 6,
  );
  await mkAnswer(qVeg.id, carol.id, "Yes — the Coached meal plans default to omnivore but have vegetarian, vegan and halal toggles. Your coach builds the weekly plan around whichever you pick.", true, 5);
  await mkVotes(qVeg.id, [dave.id, eve.id, frank.id, grace.id, hank.id, ivy.id, carol.id], 6);

  const qSwitch = await mkQuestion(
    fitcore.id, grace.id,
    "Can I switch between the Solo and Coached plans mid-month without losing my check-in history?",
    "OPEN", 3,
  );
  await mkVotes(qSwitch.id, [dave.id, eve.id, hank.id, ivy.id, frank.id, carol.id], 3);

  // Crypto Alpha Group (Marcus)
  const qAlerts = await mkQuestion(
    cryptoAlpha.id, grace.id,
    "How fresh are the on-chain alerts compared to the free Telegram channels? What's the typical delay?",
    "OPEN", 8,
  );
  await mkVotes(qAlerts.id, [alice.id, dave.id, eve.id, frank.id, hank.id, ivy.id, bob.id], 8);

  // Q&A notifications (question_asked → creator inbox, question_answered → product page)
  await notif(bob.id, "question_asked", "New question — Trade Signals Pro", `"Is there a student discount for the monthly plans? Happy to verify with my university email." — Farid Haddad`, "message", false, 4);
  await notif(carol.id, "question_asked", "New question — FitCore Coaching", `"Can I switch between the Solo and Coached plans mid-month without losing my check-in history?" — Gina Park`, "message", false, 3);
  await db.notification.create({
    data: {
      userId: alice.id,
      type: "question_answered",
      title: "Answered — SaaS Growth Blueprint",
      body: `"The Founder license activates on up to 3 devices, so laptop + desktop is fine. Studio bumps it to 10…" — Marcus Chen`,
      icon: "message",
      read: true,
      productId: saasBlueprint.id,
      createdAt: daysAgo(12),
    },
  });

  // ============ Bundle offers ============
  // Marcus bundles his two flagship trading products at 25% off.
  const tradingMastery = await db.bundle.create({
    data: {
      creatorId: bob.id,
      slug: "trading-mastery-bundle",
      title: "Trading Mastery Bundle",
      description:
        "The full desk: real-time trading signals plus on-chain crypto alpha — 25% off buying both separately.",
      discountPct: 25,
      coverTheme: "amber",
      active: true,
      createdAt: daysAgo(45),
      items: {
        create: [
          { productId: tradeSignals.id, planId: plans.tspPro!.id, sortOrder: 0 },
          { productId: cryptoAlpha.id, planId: plans.cagAnalyst!.id, sortOrder: 1 },
        ],
      },
    },
  });
  // Aisha bundles her fitness coaching + design vault at 20% off.
  await db.bundle.create({
    data: {
      creatorId: carol.id,
      slug: "fit-design-bundle",
      title: "Fit & Design Bundle",
      description:
        "Ship beautiful work and stay healthy doing it — coaching plus the full design vault, 20% off.",
      discountPct: 20,
      coverTheme: "rose",
      active: true,
      createdAt: daysAgo(20),
      items: {
        create: [
          { productId: fitcore.id, planId: plans.fcCoached!.id, sortOrder: 0 },
          { productId: designVault.id, planId: plans.dvPersonal!.id, sortOrder: 1 },
        ],
      },
    },
  });

  // Historical bundle purchase — Gina Park bought the Trading Mastery Bundle
  // 12 days ago via Stripe: two discounted subs + invoices + the purchase row
  // (same shape provisionBundle writes at checkout).
  const ginaBundleTsp = await db.subscription.create({
    data: {
      userId: grace.id,
      planId: plans.tspPro!.id,
      productId: tradeSignals.id,
      status: "ACTIVE",
      gateway: "STRIPE",
      paymentMethodId: pmGraceCard.id,
      currentPeriodStart: daysAgo(12),
      currentPeriodEnd: daysAhead(18),
      bundleId: tradingMastery.id,
      bundleTitle: "Trading Mastery Bundle",
      bundleDiscountPct: 25,
      createdAt: daysAgo(12),
    },
  });
  const ginaBundleCag = await db.subscription.create({
    data: {
      userId: grace.id,
      planId: plans.cagAnalyst!.id,
      productId: cryptoAlpha.id,
      status: "ACTIVE",
      gateway: "STRIPE",
      paymentMethodId: pmGraceCard.id,
      currentPeriodStart: daysAgo(12),
      currentPeriodEnd: daysAhead(18),
      bundleId: tradingMastery.id,
      bundleTitle: "Trading Mastery Bundle",
      bundleDiscountPct: 25,
      createdAt: daysAgo(12),
    },
  });
  await db.invoice.create({
    data: {
      number: await nextInv(),
      userId: grace.id,
      subscriptionId: ginaBundleTsp.id,
      productId: tradeSignals.id,
      description: "Trade Signals Pro — Pro (monthly) · Trading Mastery Bundle",
      amountCents: 3675,
      discountCents: 1225,
      status: "PAID",
      gateway: "STRIPE",
      periodStart: daysAgo(12),
      periodEnd: daysAhead(18),
      paidAt: daysAgo(12),
      createdAt: daysAgo(12),
    },
  });
  await db.invoice.create({
    data: {
      number: await nextInv(),
      userId: grace.id,
      subscriptionId: ginaBundleCag.id,
      productId: cryptoAlpha.id,
      description: "Crypto Alpha Group — Analyst (monthly) · Trading Mastery Bundle",
      amountCents: 7425,
      discountCents: 2475,
      status: "PAID",
      gateway: "STRIPE",
      periodStart: daysAgo(12),
      periodEnd: daysAhead(18),
      paidAt: daysAgo(12),
      createdAt: daysAgo(12),
    },
  });
  await db.bundlePurchase.create({
    data: {
      bundleId: tradingMastery.id,
      userId: grace.id,
      subtotalCents: 14800,
      discountCents: 3700,
      totalCents: 11100,
      gateway: "STRIPE",
      createdAt: daysAgo(12),
    },
  });
  // access grants + license key for the bundle's products (same pattern as
  // the other seeded subscriptions)
  await db.accessGrant.create({
    data: {
      userId: grace.id,
      productId: tradeSignals.id,
      provider: "DISCORD",
      role: "@VIP Trader",
      status: "SYNCED",
      grantedAt: daysAgo(12),
      createdAt: daysAgo(12),
    },
  });
  await db.accessGrant.create({
    data: {
      userId: grace.id,
      productId: cryptoAlpha.id,
      provider: "DISCORD",
      role: "@Alpha Whale",
      status: "SYNCED",
      grantedAt: daysAgo(12),
      createdAt: daysAgo(12),
    },
  });
  await db.accessGrant.create({
    data: {
      userId: grace.id,
      productId: cryptoAlpha.id,
      provider: "LICENSE",
      status: "SYNCED",
      grantedAt: daysAgo(12),
      createdAt: daysAgo(12),
    },
  });
  await db.licenseKey.create({
    data: {
      key: "WHPL-5D8N-R3T7-X6Q2",
      userId: grace.id,
      productId: cryptoAlpha.id,
      subscriptionId: ginaBundleCag.id,
      status: "ACTIVE",
      planName: "Analyst",
      activations: 1,
      activatedAt: daysAgo(12),
      lastUsedAt: daysAgo(2),
      createdAt: daysAgo(12),
    },
  });
  await notif(bob.id, "bundle_sold", "Bundle sold — Trading Mastery Bundle", "Gina Park · 2 products · $111.00 · save 25%", "gift", true, 12);
  await notif(grace.id, "bundle_purchased", "Bundle purchased — Trading Mastery Bundle", "You now have access to 2 products — manage them from My Hub → Memberships.", "gift", true, 12);

  console.log("✅ Seed complete:", {
    users: await db.user.count(),
    products: await db.product.count(),
    plans: await db.plan.count(),
    subscriptions: await db.subscription.count(),
    invoices: await db.invoice.count(),
    licenses: await db.licenseKey.count(),
    grants: await db.accessGrant.count(),
    endpoints: await db.webhookEndpoint.count(),
    deliveries: await db.webhookDelivery.count(),
    promos: await db.promoCode.count(),
    redemptions: await db.promoRedemption.count(),
    wishlist: await db.wishlistItem.count(),
    notifications: await db.notification.count(),
    payouts: await db.payout.count(),
    affiliatePrograms: await db.affiliateProgram.count(),
    affiliateLinks: await db.affiliateLink.count(),
    affiliateCommissions: await db.affiliateCommission.count(),
    giveaways: await db.giveaway.count(),
    giveawayEntries: await db.giveawayEntry.count(),
    questions: await db.question.count(),
    answers: await db.answer.count(),
    questionVotes: await db.questionVote.count(),
    bundles: await db.bundle.count(),
    bundleItems: await db.bundleItem.count(),
    bundlePurchases: await db.bundlePurchase.count(),
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
