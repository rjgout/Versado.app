import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/db";
import { playableAudioUrl } from "@/lib/audioMirror";
import { LANGUAGES } from "@/lib/languages";
import { pickEditionInFamily } from "@/lib/contentEdition";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ chapterId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = z.object({ chapterId: z.string().min(1).max(200) }).safeParse(await params);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const selectable = { enabled: true, ...(user.isAdmin ? {} : { visibleToUsers: true }) };
  const chapter = await prisma.chapter.findFirst({
    where: { id: parsed.data.chapterId, book: { contentCollection: selectable } },
    include: { book: { include: { contentCollection: true } } },
  });
  if (!chapter) return await apiError("apiErrors.itemNotFound", 404);
  const { key, contentCollection } = chapter.book;
  if (!key || !contentCollection.work) return NextResponse.json({ editions: [] });

  // Dezelfde canonieke verwijzing in dezelfde uitgavefamilie; zo wordt bij
  // meerdere vertalingen niet stilzwijgend audio uit een andere vertaling gekozen.
  const chapters = await prisma.chapter.findMany({
    where: {
      number: chapter.number,
      book: { key, contentCollection: { ...selectable, work: contentCollection.work, editionKey: contentCollection.editionKey } },
    },
    select: {
      audioUrl: true,
      book: { select: { contentCollection: { select: { language: true, work: true, editionKey: true } } } },
      verses: { orderBy: { number: "asc" }, select: { number: true, text: true, audioStart: true } },
    },
  });
  return NextResponse.json({
    editions: LANGUAGES.flatMap(({ code }) => {
      const edition = pickEditionInFamily(
        chapters.map((item) => ({ ...item, ...item.book.contentCollection })),
        contentCollection,
        code,
      );
      return edition?.verses.length ? [{ language: code, url: playableAudioUrl(edition.audioUrl), verses: edition.verses }] : [];
    }),
  });
}
