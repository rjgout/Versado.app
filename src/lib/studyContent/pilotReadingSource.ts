import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { readingAccessWhere } from "@/lib/contentAccess";
import { chapterEvidenceHash } from "@/lib/references/evidence";
import {
  pilotReadingSelections,
  type StudyScriptureReading,
} from "./pilotReadings";
import type { PublishedStudyDTO } from "./revisions";

/** Alleen lezen uit werkelijk vrijgegeven Versado-teksten; nooit een import of vertalingsfallback. */
export async function loadPilotReadings(
  actor: { isAdmin: boolean },
  lesson: PublishedStudyDTO,
  db: PrismaClient | Prisma.TransactionClient,
  lock = false,
): Promise<StudyScriptureReading[]> {
  const selections = pilotReadingSelections(lesson);
  if (!selections.length) return [];
  let collection = await db.contentCollection.findFirst({
    where: {
      ...readingAccessWhere(actor),
      work: "pgp",
      editionKey: "pgp",
      language: "nl",
      contentWork: { kind: "SCRIPTURE" },
    },
    select: { id: true },
  });
  if (!collection) return [];
  if (lock) {
    await db.$queryRaw`SELECT id FROM "ContentCollection" WHERE id=${collection.id} FOR SHARE`;
    collection = await db.contentCollection.findFirst({
      where: {
        id: collection.id,
        ...readingAccessWhere(actor),
        work: "pgp",
        editionKey: "pgp",
        language: "nl",
        contentWork: { kind: "SCRIPTURE" },
      },
      select: { id: true },
    });
    if (!collection) return [];
    const chapters = await db.$queryRaw<
      Array<{ id: string }>
    >`SELECT c.id FROM "Chapter" c JOIN "Book" b ON b.id=c."bookId" WHERE b."contentCollectionId"=${collection.id} AND ((b.key='pgp/moses' AND c.number=1) OR (b.key='pgp/abr' AND c.number=3)) ORDER BY c.id FOR SHARE OF c,b`;
    if (chapters.length)
      await db.$queryRaw`SELECT id FROM "Verse" WHERE "chapterId" IN (${Prisma.join(chapters.map((c) => c.id))}) ORDER BY id FOR SHARE`;
  }
  const chapters = await db.chapter.findMany({
    where: {
      book: { contentCollectionId: collection.id },
      OR: [
        { number: 1, book: { key: "pgp/moses" } },
        { number: 3, book: { key: "pgp/abr" } },
      ],
    },
    select: {
      id: true,
      number: true,
      book: { select: { key: true, name: true } },
      verses: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, text: true },
      },
    },
  });
  const result: StudyScriptureReading[] = [];
  for (const chapter of chapters) {
    const selected = selections.filter(
      (q) => q.bookKey === chapter.book.key && q.chapter === chapter.number,
    );
    const expected = selected[0];
    if (
      !expected ||
      chapter.verses.length !== expected.verseCount ||
      chapterEvidenceHash(chapter.verses) !== expected.chapterHash
    )
      continue;
    for (const stepIndex of new Set(selected.map((q) => q.stepIndex))) {
      const numbers = new Set(
        selected.filter((q) => q.stepIndex === stepIndex).map((q) => q.verse),
      );
      const verses = chapter.verses.filter((v) => numbers.has(v.number));
      if (verses.length !== numbers.size) continue;
      result.push({
        stepIndex,
        collectionId: collection.id,
        chapterId: chapter.id,
        work: "pgp",
        editionKey: "pgp",
        language: "nl",
        bookKey: chapter.book.key!,
        bookName: chapter.book.name,
        chapter: chapter.number,
        chapterHash: expected.chapterHash,
        verses,
      });
    }
  }
  return result.sort(
    (a, b) =>
      a.stepIndex - b.stepIndex ||
      selections.findIndex(
        (q) =>
          q.stepIndex === a.stepIndex &&
          q.bookKey === a.bookKey &&
          q.chapter === a.chapter,
      ) -
        selections.findIndex(
          (q) =>
            q.stepIndex === b.stepIndex &&
            q.bookKey === b.bookKey &&
            q.chapter === b.chapter,
        ),
  );
}
