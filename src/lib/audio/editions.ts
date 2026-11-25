import type { ContentActor } from "@/lib/contentAccess";
import { readingAccessWhere } from "@/lib/contentAccess";
import { prisma } from "@/lib/db";
import { playableAudioUrl } from "@/lib/audioMirror";
import { activeChapterAudio } from "@/lib/audio/library";
import { LANGUAGES } from "@/lib/languages";
import { pickEditionInFamily } from "@/lib/contentEdition";

/** Eén selectie-/uitgavefamilieservice voor web en native; geen imports of writes. */
export async function chapterAudioEditions(user:ContentActor,chapterId:string) {
  const selectable = readingAccessWhere(user);
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, book: { contentCollection: selectable } },
    include: { book: { include: { contentCollection: true } } },
  });
  if (!chapter) return null;
  const { key, contentCollection } = chapter.book;
  if (!key || !contentCollection.work) return { editions: [] };

  // Dezelfde canonieke verwijzing in dezelfde uitgavefamilie; zo wordt bij
  // meerdere vertalingen niet stilzwijgend audio uit een andere vertaling gekozen.
  const chapters = await prisma.chapter.findMany({
    where: {
      number: chapter.number,
      book: { key, contentCollection: { ...selectable, work: contentCollection.work, editionKey: contentCollection.editionKey } },
    },
    select: {
      id: true, heading: true, audioUrl: true,
      book: { select: { contentCollection: { select: { language: true, work: true, editionKey: true } } } },
      verses: { orderBy: { number: "asc" }, select: { id: true, number: true, text: true, audioStart: true } },
    },
  });
  const resolved = await Promise.all(chapters.map(async (item) => {
    const recording = await activeChapterAudio(item);
    return recording === undefined ? item : recording ? { ...item, audioUrl: recording.url, legacyFallback:recording.legacyFallback, verses: item.verses.map((v, i) => ({ ...v, audioStart: recording.verses[i].audioStart })) } : { ...item, audioUrl: null, verses: item.verses.map((v) => ({ ...v, audioStart: null })) };
  }));
  return {
    editions: LANGUAGES.flatMap(({ code }) => {
      const edition = pickEditionInFamily(
        resolved.map((item) => ({ ...item, ...item.book.contentCollection })),
        contentCollection,
        code,
      );
      return edition?.verses.length ? [{ language: code, url: playableAudioUrl(edition.audioUrl), legacyFallback:"legacyFallback" in edition ? edition.legacyFallback : null, verses: edition.verses }] : [];
    }),
  };
}
