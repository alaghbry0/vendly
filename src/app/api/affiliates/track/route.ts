import { errorResponse, HttpError } from "@/lib/session";
import { recordClick } from "@/lib/affiliates";

// POST /api/affiliates/track {code, productId} — public: records a landing
// click on an affiliate link. Fire-and-forget from the product page.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "");
    const productId = String(body.productId || "");
    if (!code || !productId) throw new HttpError(400, "Missing code or productId.");

    const ok = await recordClick(code, productId);
    if (!ok) throw new HttpError(404, "Referral link not found for that product.");
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
