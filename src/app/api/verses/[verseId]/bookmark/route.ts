import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

export async function POST(_req: Request, { params }: { params: Promise<{ verseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { verseId } = await params;
  const verse = await prisma.verse.findFirst({
    where: { id: verseId, chapter: { book: { contentCollection: readingAccessWhere(user) } } },
    select: { id: true },
  });
  if (!verse) return await apiError("apiErrors.verseNotFound", 404);

  const existing = await prisma.bookmark.findUnique({ where: { userId_verseId: { userId: user.id, verseId } } });

  if (existing) {
    await prisma.bookmark.delete({ where: { id: existing.id } });
    return NextResponse.json({ bookmarked: false });
  }

  await prisma.bookmark.create({ data: { userId: user.id, verseId } });
  return NextResponse.json({ bookmarked: true });
}
