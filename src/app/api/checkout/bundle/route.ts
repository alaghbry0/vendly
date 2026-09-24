import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { chargeStripeCard, chargePaypal, detectCardBrand } from "@/lib/gateways";
import {
  assertBundlePurchasable,
  bundleReceiptItems,
  loadBundleForCheckout,
  provisionBundle,
} from "@/lib/bundles";

// POST /api/checkout/bundle — buy every product in a bundle in one checkout
// (Stripe/PayPal simulated gateways; Whop uses whop-confirm, crypto N/A).
//
// body: { bundleId, gateway: STRIPE|PAYPAL, card?: {number,expMonth,expYear,cvc},
//         paypalEmail?, saveMethod? }
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const bundleId = String(body.bundleId || "");
    const gateway = String(body.gateway || "");
    if (gateway !== "STRIPE" && gateway !== "PAYPAL") {
      throw new HttpError(400, "Whop card checkout uses the confirm flow; crypto is not available for bundles.");
    }

    const loaded = await loadBundleForCheckout(bundleId);

    // duplicate-subscription guard BEFORE charging
    await assertBundlePurchasable(user.id, loaded);

    // ---------- charge the bundle total ----------
    const charge =
      gateway === "STRIPE"
        ? await chargeStripeCard(
            {
              number: String(body.card?.number || "").replace(/\s/g, ""),
              expMonth: Number(body.card?.expMonth),
              expYear: Number(body.card?.expYear),
              cvc: String(body.card?.cvc || ""),
            },
            loaded.totalCents
          )
        : await chargePaypal(String(body.paypalEmail || "").trim().toLowerCase(), loaded.totalCents);
    if (!charge.ok) throw new HttpError(402, charge.error || "Payment failed.");

    // ---------- optional payment-method save (same pattern as /api/checkout) ----------
    let pmId: string | null = null;
    if (body.saveMethod !== false) {
      if (gateway === "STRIPE") {
        const number = String(body.card?.number || "").replace(/\s/g, "");
        const pm = await db.paymentMethod.create({
          data: {
            userId: user.id,
            type: "CARD",
            gateway: "STRIPE",
            brand: detectCardBrand(number),
            last4: number.slice(-4),
            expMonth: Number(body.card?.expMonth),
            expYear: Number(body.card?.expYear),
          },
        });
        pmId = pm.id;
      } else {
        const pm = await db.paymentMethod.create({
          data: {
            userId: user.id,
            type: "PAYPAL",
            gateway: "PAYPAL",
            email: String(body.paypalEmail || "").trim().toLowerCase(),
          },
        });
        pmId = pm.id;
      }
    }

    // ---------- provision every included product + the purchase row ----------
    const { purchase, results } = await provisionBundle({
      userId: user.id,
      loaded,
      gateway,
      paymentMethodId: pmId,
      txnId: charge.txnId,
    });

    return Response.json(
      {
        status: "COMPLETED",
        purchaseId: purchase.id,
        bundle: { id: loaded.bundle.id, title: loaded.bundle.title, discountPct: loaded.bundle.discountPct },
        subtotalCents: loaded.subtotalCents,
        discountCents: loaded.discountCents,
        totalCents: loaded.totalCents,
        gateway,
        items: bundleReceiptItems(loaded, results),
      },
      { status: 201 }
    );
  } catch (e) {
    return errorResponse(e);
  }
}
