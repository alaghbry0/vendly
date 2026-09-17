import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { detectCardBrand } from "@/lib/gateways";
import type { PaymentMethodDTO } from "@/lib/types";

function serialize(pm: Awaited<ReturnType<typeof findPm>>): PaymentMethodDTO {
  return {
    id: pm.id,
    type: pm.type,
    gateway: pm.gateway,
    brand: pm.brand,
    last4: pm.last4,
    expMonth: pm.expMonth,
    expYear: pm.expYear,
    email: pm.email,
    walletAddress: pm.walletAddress,
    chain: pm.chain,
    isDefault: pm.isDefault,
  };
}
type WithId = { id: string };
async function findPm(id: string) {
  return db.paymentMethod.findUniqueOrThrow({ where: { id } });
}

// GET /api/payment-methods — my saved methods
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const pms = await db.paymentMethod.findMany({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return Response.json({ paymentMethods: pms.map(serialize) });
  } catch (e) {
    return errorResponse(e);
  }
}

// POST /api/payment-methods — add a method
// body: { type: CARD|PAYPAL|CRYPTO, card?{...}, paypalEmail?, walletAddress?, makeDefault? }
export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const type = String(body.type || "");

    let pm;
    if (type === "CARD") {
      const card = body.card || {};
      const number = String(card.number || "").replace(/\s/g, "");
      if (!/^\d{13,19}$/.test(number)) throw new HttpError(400, "Invalid card number.");
      if (number.endsWith("0002") || number.endsWith("9995")) {
        throw new HttpError(402, "This test card always declines — try 4242 4242 4242 4242.");
      }
      pm = await db.paymentMethod.create({
        data: {
          userId: user.id,
          type: "CARD",
          gateway: "STRIPE",
          brand: detectCardBrand(number),
          last4: number.slice(-4),
          expMonth: Number(card.expMonth),
          expYear: Number(card.expYear),
        },
      });
    } else if (type === "PAYPAL") {
      const email = String(body.paypalEmail || "").trim().toLowerCase();
      if (!email.includes("@")) throw new HttpError(400, "Enter the PayPal account email.");
      pm = await db.paymentMethod.create({
        data: { userId: user.id, type: "PAYPAL", gateway: "PAYPAL", email },
      });
    } else if (type === "CRYPTO") {
      const wallet = String(body.walletAddress || "").trim();
      if (!/^0x[a-fA-F0-9]{6,}$/.test(wallet)) throw new HttpError(400, "Enter a valid EVM wallet address (0x…).");
      pm = await db.paymentMethod.create({
        data: { userId: user.id, type: "CRYPTO", gateway: "CRYPTO", walletAddress: wallet, chain: "ETH" },
      });
    } else {
      throw new HttpError(400, "Unknown payment method type.");
    }

    if (body.makeDefault) {
      await db.paymentMethod.updateMany({ where: { userId: user.id, id: { not: pm.id } }, data: { isDefault: false } });
      await db.paymentMethod.update({ where: { id: pm.id }, data: { isDefault: true } });
    }

    const fresh = await findPm(pm.id);
    return Response.json({ paymentMethod: serialize(fresh) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
