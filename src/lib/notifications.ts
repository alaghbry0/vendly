import { db } from "@/lib/db";

// ============ In-app notification center ============
// Events that matter to a user land here in addition to webhook fan-out.
// Types drive the bell UI (icon + colour + optional deep link).

export type NotificationIcon =
  | "receipt"
  | "alert"
  | "user-plus"
  | "x-circle"
  | "refresh"
  | "key"
  | "star"
  | "tag"
  | "bank"
  | "share"
  | "bell";

export async function notify(opts: {
  userId: string;
  type: string;
  title: string;
  body?: string;
  icon?: NotificationIcon;
}): Promise<void> {
  try {
    await db.notification.create({
      data: {
        userId: opts.userId,
        type: opts.type,
        title: opts.title,
        body: opts.body ?? null,
        icon: opts.icon ?? "bell",
      },
    });
  } catch {
    // notifications must never break the billing path
  }
}

// Which view/tab a notification deep-links to, if any.
export function notificationTarget(type: string): { view: "portal" | "creator"; tab: string } | null {
  switch (type) {
    case "invoice_paid":
    case "payment_failed":
    case "past_due":
    case "trial_converted":
    case "subscription_canceled":
    case "subscription_renewed":
      return { view: "portal", tab: "invoices" };
    case "license_created":
      return { view: "portal", tab: "licenses" };
    case "subscription_created":
      return { view: "creator", tab: "subscribers" };
    case "review_new":
      return { view: "creator", tab: "products" };
    case "promo_redeemed":
      return { view: "creator", tab: "promos" };
    case "payout_paid":
    case "payout_pending":
      return { view: "creator", tab: "payouts" };
    case "affiliate_earned":
    case "affiliate_paid":
      return { view: "portal", tab: "affiliates" };
    case "affiliate_joined":
      return { view: "creator", tab: "affiliates" };
    default:
      return null;
  }
}
