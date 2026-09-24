import { db } from "@/lib/db";
import type { Answer, Plan, Product, Question, QuestionVote, User } from "@prisma/client";
import type { AnswerDTO, PlanDTO, ProductCardDTO, ProductDetailDTO, QuestionDTO } from "@/lib/types";

type ProductWithRelations = Product & {
  creator: Pick<User, "id" | "name" | "avatarColor" | "bio">;
  plans: Plan[];
};

export function parseAccessTypes(accessType: string): string[] {
  return (accessType || "LINK").split(",").map((s) => s.trim()).filter(Boolean);
}

export function serializePlan(p: Plan): PlanDTO {
  let features: string[] = [];
  try {
    features = JSON.parse(p.features || "[]");
  } catch {
    features = [];
  }
  return {
    id: p.id,
    productId: p.productId,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    currency: p.currency,
    interval: p.interval as "month" | "year",
    trialDays: p.trialDays,
    badge: p.badge,
    features,
    sortOrder: p.sortOrder,
    active: p.active,
  };
}

export function serializeProductCard(p: ProductWithRelations): ProductCardDTO {
  const plans = p.plans.filter((pl) => pl.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const fromPrice = plans.length ? Math.min(...plans.map((pl) => pl.priceCents)) : null;
  const intervals = Array.from(new Set(plans.map((pl) => pl.interval)));
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    tagline: p.tagline,
    category: p.category,
    coverTheme: p.coverTheme,
    accessType: parseAccessTypes(p.accessType),
    status: p.status,
    featured: p.featured,
    membersCount: p.membersCount,
    rating: p.rating,
    reviewCount: p.reviewCount,
    fromPriceCents: fromPrice,
    intervals,
    creator: { id: p.creator.id, name: p.creator.name, avatarColor: p.creator.avatarColor },
    plans: plans.map(serializePlan),
  };
}

export function serializeProductDetail(
  p: ProductWithRelations & {
    assets: (typeof p extends never ? never : any)[];
    reviews: { id: string; authorName: string; rating: number; comment: string; createdAt: Date }[];
    affiliateProgram?: { commissionBps: number; active: boolean } | null;
  },
  hasAccess: boolean,
  bundleOffer?: { id: string; title: string; discountPct: number; productCount: number } | null
): ProductDetailDTO {
  return {
    ...serializeProductCard(p),
    description: p.description,
    discordRoleName: p.discordRoleName,
    telegramChannel: p.telegramChannel,
    refundPolicy: p.refundPolicy === "KEEP_ACCESS" ? "KEEP_ACCESS" : "REVOKE",
    createdAt: p.createdAt.toISOString(),
    assets: p.assets.map((a: any) => ({
      id: a.id,
      name: a.name,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      version: a.version,
      requiresLicense: a.requiresLicense,
      downloadCount: a.downloadCount,
    })),
    reviews: p.reviews.map((r) => ({
      id: r.id,
      authorName: r.authorName,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    })),
    creator: {
      id: p.creator.id,
      name: p.creator.name,
      avatarColor: p.creator.avatarColor,
      bio: p.creator.bio,
    },
    hasAccess,
    affiliateBps: p.affiliateProgram?.active ? p.affiliateProgram.commissionBps : null,
    bundleOffer: bundleOffer ?? null,
  };
}

export async function hasActiveAccess(userId: string, productId: string): Promise<boolean> {
  const sub = await db.subscription.findFirst({
    where: { userId, productId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] } },
  });
  return !!sub;
}

// ============ Product Q&A ============
type QaAuthor = Pick<User, "id" | "name" | "email" | "avatarColor">;

export type QuestionWithRelations = Question & {
  author: QaAuthor;
  answers: (Answer & { author: QaAuthor })[];
  votes: QuestionVote[];
};

function qaAuthor(u: QaAuthor) {
  return { id: u.id, name: u.name || u.email, avatarColor: u.avatarColor };
}

export function serializeAnswer(a: Answer & { author: QaAuthor }): AnswerDTO {
  return {
    id: a.id,
    body: a.body,
    isCreator: a.isCreator,
    createdAt: a.createdAt.toISOString(),
    author: qaAuthor(a.author),
  };
}

// viewerId drives hasVoted (null/anonymous → false). Answers come back oldest-first.
export function serializeQuestion(q: QuestionWithRelations, viewerId: string | null): QuestionDTO {
  const answers = [...q.answers].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return {
    id: q.id,
    body: q.body,
    status: q.status === "ANSWERED" ? "ANSWERED" : "OPEN",
    createdAt: q.createdAt.toISOString(),
    author: qaAuthor(q.author),
    upvotes: q.votes.length,
    hasVoted: viewerId ? q.votes.some((v) => v.userId === viewerId) : false,
    answers: answers.map(serializeAnswer),
    answerCount: answers.length,
  };
}

// shared include that hydrates QuestionWithRelations (author/answers/votes)
export const QUESTION_INCLUDE = {
  author: { select: { id: true, name: true, email: true, avatarColor: true } },
  answers: { include: { author: { select: { id: true, name: true, email: true, avatarColor: true } } } },
  votes: true,
} as const;
