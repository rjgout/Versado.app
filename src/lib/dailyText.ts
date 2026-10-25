import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { CFM_PROGRAMME_KEY, CFM_PROGRAMME_NAME, cfmVolumeOfWork } from "@/lib/studyContent/cfmProgramme";
import { CFM_VOLUMES } from "@/lib/studyContent/cfmVolumes";
import { getPublishedStudyLesson } from "@/lib/studyContent/revisions";
import { parseStudyDocument } from "@/lib/studyContent/schema";
import { studyDocumentInventory } from "@/lib/studyContent/fixtureAdapter";
import { resolveReferenceBatch } from "@/lib/references/resolver";
import { dailyTextIndex, lessonDailyQuotes } from "@/lib/dailyTextRules";

type Actor = { id: string; isAdmin: boolean };
export interface DailyText {
  href: string;
  reference: string;
  sourceName: string;
  bookName: string | null;
  chapterNumber: number | null;
  verseNumber: number | null;
  text: string;
}
export interface DailyTextRequest {
  actor: Actor;
  date?: Date;
  language?: string | null;
  timeZone?: string | null;
  /** Vandaag gebruikt de exacte actieve uitgave, zonder de profielkeuze te lezen. */
  collectionId?: string | null;
  /** Push/mail gebruiken een werk, standaard het permanente CFM-programma. */
  source?: string | null;
}

/** Toegankelijke werken, één optie per werk; CFM blijft één permanent programma. */
export async function dailyTextSourceOptions(actor: Actor, language?: string | null) {
  const rows = await prisma.contentCollection.findMany({
    where: readingAccessWhere(actor), orderBy: [{ order: "asc" }, { id: "asc" }],
    select: { work: true, name: true, language: true },
  });
  const works = new Map<string, { value: string; label: string; language: string }>();
  for (const row of rows) {
    if (!row.work || cfmVolumeOfWork(row.work)) continue;
    if (!works.has(row.work) || row.language === language) works.set(row.work, { value: row.work, label: row.name, language: row.language });
  }
  return [{ value: CFM_PROGRAMME_KEY, label: CFM_PROGRAMME_NAME }, ...[...works.values()].map(({ value, label }) => ({ value, label }))];
}

async function collectionVerse(collectionId: string, sourceName: string, day: string): Promise<DailyText | null> {
  const where = { text: { not: "" }, chapter: { book: { contentCollectionId: collectionId } } };
  const total = await prisma.verse.count({ where });
  if (!total) return null;
  const verse = await prisma.verse.findFirst({
    where, skip: dailyTextIndex(day, total),
    orderBy: [{ chapter: { book: { order: "asc" } } }, { chapter: { order: "asc" } }, { number: "asc" }, { id: "asc" }],
    select: { number: true, text: true, chapter: { select: { id: true, number: true, book: { select: { name: true } } } } },
  });
  if (!verse?.text.trim()) return null;
  const bookName = verse.chapter.book.name;
  return { href: `/scripture/${encodeURIComponent(verse.chapter.id)}#vers-${verse.number}`, reference: `${bookName} ${verse.chapter.number}:${verse.number}`,
    sourceName, bookName, chapterNumber: verse.chapter.number, verseNumber: verse.number, text: verse.text };
}

async function studyText(actor: Actor, day: string, collectionIds: string[], cfm: boolean): Promise<DailyText | null> {
  const date = new Date(`${day}T00:00:00Z`);
  const where = { collectionId: { in: collectionIds }, collection: readingAccessWhere(actor), publishedRevisionId: { not: null },
      lesson: { retiredAt: null, ...(cfm ? { startsOn: { lte: date }, endsOnExclusive: { gt: date } } : {}) } };
  const editions = await prisma.studyLessonEdition.findMany({
    where,
    orderBy: [{ lesson: { order: "asc" } }, { id: "asc" }],
    select: { lessonId: true, collectionId: true, workKey: true, collection: { select: { name: true, editionKey: true, language: true } } },
    // CFM: bij overlappende weken geen willekeurige keuze.
    ...(cfm ? { take: 2 } : {}),
  });
  if (!editions.length || (cfm && editions.length !== 1)) return null;
  const start = dailyTextIndex(day, editions.length);
  for (let i = 0; i < editions.length; i++) {
    const text = await studyEditionText(actor, day, editions[(start + i) % editions.length], cfm);
    if (text) return text;
  }
  return null;
}

async function studyEditionText(actor: Actor, day: string, edition: {
  lessonId: string; collectionId: string; workKey: string;
  collection: { name: string; editionKey: string; language: string };
}, cfm: boolean): Promise<DailyText | null> {
  const published = await getPublishedStudyLesson(actor, edition.lessonId, edition.collectionId);
  if (!published) return null;
  const body = parseStudyDocument(published.body);
  const sourceName = cfm ? CFM_PROGRAMME_NAME : edition.collection.name;
  const refs = studyDocumentInventory(body).references.filter(ref => {
    const key = String(ref.target.sourceKey ?? "");
    return key.startsWith("otb:") || key.startsWith("otb-set:") || key.includes("/study/scriptures/");
  });
  // De bestaande resolver bewaakt bron, taal, editie, publicatie en versnummering.
  const candidates = new Map<string, DailyText>();
  const chapters = new Map<string, { number: number; book: { name: string } } | null>();
  for (let offset = 0; offset < refs.length; offset += 200) {
    const resolved = await resolveReferenceBatch(prisma, actor, { workKey: edition.workKey, collectionId: edition.collectionId,
      editionKey: edition.collection.editionKey, language: edition.collection.language },
    refs.slice(offset, offset + 200).map(ref => ({ ...ref, diagnosticKey: ref.occurrenceKey })));
    for (const result of resolved) {
      if (result.kind !== "internal" || result.preview.kind !== "scripture") continue;
      const chapterId = result.preview.chapterId;
      if (!chapters.has(chapterId)) chapters.set(chapterId, await prisma.chapter.findUnique({ where: { id: chapterId }, select: { number: true, book: { select: { name: true } } } }));
      const chapter = chapters.get(chapterId);
      if (!chapter) continue;
      for (const verse of result.preview.verses) {
        if (!verse.text.trim()) continue;
        candidates.set(`${chapterId}:${verse.number}`, {
          href: `/scripture/${encodeURIComponent(chapterId)}#vers-${verse.number}`,
          reference: `${chapter.book.name} ${chapter.number}:${verse.number}`, sourceName,
          bookName: chapter.book.name, chapterNumber: chapter.number, verseNumber: verse.number, text: verse.text,
        });
      }
    }
  }
  const verses = [...candidates.values()];
  if (verses.length) return verses[dailyTextIndex(day, verses.length)];
  const quotes = lessonDailyQuotes(body);
  if (!quotes.length) return null;
  const quote = quotes[dailyTextIndex(day, quotes.length)];
  return { href: `/study-lesson/${encodeURIComponent(edition.lessonId)}/${encodeURIComponent(edition.collectionId)}?weergave=volledig#study-${encodeURIComponent(quote.anchor)}`,
    reference: published.title, sourceName, bookName: null, chapterNumber: null, verseNumber: null, text: quote.text };
}

/** Eén selectiepad; ontbrekende content valt uitsluitend terug op de actuele CFM-week. */
export async function getTextOfTheDay(request: DailyTextRequest): Promise<DailyText | null> {
  const { actor, language, collectionId, source = CFM_PROGRAMME_KEY } = request;
  const day = dayKeyInZone(request.date ?? new Date(), resolveTimeZone(request.timeZone));
  if (collectionId || (source && source !== CFM_PROGRAMME_KEY && !cfmVolumeOfWork(source))) {
    const collections = await prisma.contentCollection.findMany({
      where: { ...readingAccessWhere(actor), ...(collectionId ? { id: collectionId } : { work: source! }) },
      orderBy: [{ order: "asc" }, { id: "asc" }], include: { contentWork: { select: { kind: true } } },
    });
    const collection = collectionId ? collections[0] : collections.find(c => c.language === language) ?? collections.find(c => c.language === "nl") ?? collections[0];
    if (collection && !cfmVolumeOfWork(collection.work)) {
      const text = collection.contentWork?.kind === "SCRIPTURE"
        ? await collectionVerse(collection.id, collection.name, day)
        : collection.contentWork?.kind === "STUDY_PROGRAM" ? await studyText(actor, day, [collection.id], false) : null;
      if (text) return text;
    }
  }
  const volumes = CFM_VOLUMES.filter(v => v.language === language);
  const ids = (volumes.length ? volumes : CFM_VOLUMES.filter(v => v.language === "nl")).map(v => v.collectionId);
  return studyText(actor, day, ids, true);
}
