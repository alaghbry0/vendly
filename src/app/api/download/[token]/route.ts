import { db } from "@/lib/db";

// GET /api/download/[token] — streams the asset if the token is valid.
// Tokens expire after 10 minutes and allow up to 3 uses.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const dt = await db.downloadToken.findUnique({ where: { token }, include: { asset: true } });
  if (!dt) return new Response("Download link not found.", { status: 404 });
  if (dt.expiresAt.getTime() < Date.now()) return new Response("Download link expired.", { status: 410 });
  if (dt.uses >= dt.maxUses) return new Response("Download link usage exceeded.", { status: 429 });

  await db.downloadToken.update({ where: { id: dt.id }, data: { uses: { increment: 1 } } });

  const header =
    `=========================================\n` +
    `  Vendly Secure Delivery\n` +
    `  ${dt.asset.name} — v${dt.asset.version}\n` +
    `=========================================\n\n`;
  const body = dt.asset.content || `# ${dt.asset.name}\n(Asset content)`;
  const footer = `\n\n— Delivered securely by Vendly. Licensed for personal use by the purchaser.\n`;

  return new Response(header + body + footer, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dt.asset.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
