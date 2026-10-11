import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const bookmarks = await prisma.bookmark.findMany({
    // Alleen leesbare brontekst teruggeven; verborgen privérecords blijven opgeslagen.
    where: { userId: user.id, verse: { chapter: { book: { contentCollection: readingAccessWhere(user) } } } },
    orderBy: { createdAt: "desc" },
    include: { verse: { include: { chapter: { include: { book: true } } } } },
  });

  return NextResponse.json(
    bookmarks.map((b) => ({
      verseId: b.verseId,
      bookName: b.verse.chapter.book.name,
      chapterNumber: b.verse.chapter.number,
      chapterId: b.verse.chapter.id,
      verseNumber: b.verse.number,
      text: b.verse.text,
    }))
  );
}
