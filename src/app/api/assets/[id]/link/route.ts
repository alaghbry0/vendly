import { db } from "@/lib/db";
import { errorResponse, HttpError, requireUser } from "@/lib/session";
import { generateDownloadToken } from "@/lib/licenses";
import { hasActiveAccess } from "@/lib/serialize";

// POST /api/assets/[id]/link — mint a short-lived, use-limited secure
// download token. Requires an active subscription on the product.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const asset = await db.digitalAsset.findUnique({ where: { id }, include: { product: true } });
    if (!asset) throw new HttpError(404, "Asset not found.");

    const hasAccess = await hasActiveAccess(user.id, asset.productId);
    if (!hasAccess) throw new HttpError(403, "An active membership is required to download this file.");

    if (asset.requiresLicense) {
      const lic = await db.licenseKey.findFirst({
        where: { userId: user.id, productId: asset.productId, status: "ACTIVE" },
      });
      if (!lic) throw new HttpError(403, "This asset requires an active license key.");
    }

    const token = generateDownloadToken();
    await db.downloadToken.create({
      data: {
        token,
        assetId: asset.id,
        userId: user.id,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        maxUses: 3,
      },
    });
    await db.digitalAsset.update({ where: { id: asset.id }, data: { downloadCount: { increment: 1 } } });

    return Response.json({
      url: `/api/download/${token}`,
      expiresIn: 600,
      maxUses: 3,
      fileName: asset.fileName,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
