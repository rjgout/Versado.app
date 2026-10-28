import { z } from "zod";
import { NextResponse } from "next/server";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { apiError } from "@/lib/apiError";
import { markAudioCurrent } from "@/lib/audioCheck";

const headers = { "Cache-Control": "no-store, private" };

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { error: await apiError("apiErrors.notLoggedIn", 401) };
  if (!user.isAdmin) return { error: await apiError("apiErrors.forbidden", 403) };
  return { user };
}

// Hoofdstukken waarvan de tekst veranderde en waarvan de voorgelezen audio nog gecontroleerd moet worden. De audio zelf blijft afspeelbaar.
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const rows = await prisma.chapterAudioCheck.findMany({
    where: { status: "NEEDS_REVIEW" },
    orderBy: { flaggedAt: "asc" },
    take: 200,
    select: { chapterId: true, detail: true, flaggedAt: true, chapter: { select: { number: true, book: { select: { name: true, contentCollectionId: true } } } } },
  });
  return NextResponse.json(
    { items: rows.map((row) => ({ chapterId: row.chapterId, book: row.chapter.book.name, chapter: row.chapter.number, collectionId: row.chapter.book.contentCollectionId, detail: row.detail, flaggedAt: row.flaggedAt })) },
    { headers },
  );
}

// Expliciete bevestiging door een beheerder: de audio past (nog) bij de huidige tekst.
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return await apiError("apiErrors.forbidden", 403);
  const raw = await req.text();
  if (raw.length > 1024) return await apiError("apiErrors.invalidInput", 400);
  const parsed = z.object({ chapterId: z.string().min(1).max(64), action: z.literal("confirm") }).strict().safeParse(await Promise.resolve().then(() => JSON.parse(raw)).catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const row = await prisma.chapterAudioCheck.findUnique({ where: { chapterId: parsed.data.chapterId }, select: { status: true } });
  if (!row) return await apiError("adminContentUpdate.chapterNotFound", 404);
  await markAudioCurrent(prisma, parsed.data.chapterId, auth.user.id);
  return NextResponse.json({ ok: true }, { headers });
}
