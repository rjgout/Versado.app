import { BOOK_KEYS_BY_SLUG } from "../../prisma/bookKeys";
import bomContent from "../../prisma/bomContent.json";
import bomContentEn from "../../prisma/bomContent.en.json";
import bomContentDe from "../../prisma/bomContent.de.json";
import bomContentFr from "../../prisma/bomContent.fr.json";
import bomContentEs from "../../prisma/bomContent.es.json";
import {
  BOM_COLLECTION_ID, BOM_DE_COLLECTION_ID, BOM_EN_COLLECTION_ID, BOM_ES_COLLECTION_ID, BOM_FR_COLLECTION_ID,
} from "../../src/lib/contentCollections";
import type { GeneesBankSeed, VerseProvider } from "../../src/lib/snelleZendeling/reviveBank";

interface SourceBook {
  slug: string;
  key?: string;
  chapters: { number: number; verses: unknown[] }[];
}

// De bronverzen van de uitgave waar een bank bij hoort, voor de brontekstcontrole.
const SOURCES: Record<string, SourceBook[]> = {
  [BOM_COLLECTION_ID]: bomContent as SourceBook[],
  [BOM_EN_COLLECTION_ID]: bomContentEn as unknown as SourceBook[],
  [BOM_DE_COLLECTION_ID]: bomContentDe as unknown as SourceBook[],
  [BOM_FR_COLLECTION_ID]: bomContentFr as unknown as SourceBook[],
  [BOM_ES_COLLECTION_ID]: bomContentEs as unknown as SourceBook[],
};

function verseText(verse: unknown): string {
  if (typeof verse === "string") return verse;
  if (verse && typeof verse === "object" && "text" in verse) return String((verse as { text: unknown }).text);
  return "";
}

/** Alle hoofdstukken van de uitgave van een bank, als (boek zonder werkvoorvoegsel, nummer). */
export function chaptersOf(bank: GeneesBankSeed): { book: string; chapter: number }[] {
  const books = SOURCES[bank.collectionId] ?? [];
  return books.flatMap((book) => {
    const key = book.key ?? BOOK_KEYS_BY_SLUG[book.slug];
    return key?.startsWith(`${bank.work}/`) ? book.chapters.map((chapter) => ({ book: key.slice(bank.work.length + 1), chapter: chapter.number })) : [];
  });
}

export function verseProviderFor(bank: GeneesBankSeed): VerseProvider {
  const verses = new Map<string, string[]>();
  for (const book of SOURCES[bank.collectionId] ?? []) {
    const key = book.key ?? BOOK_KEYS_BY_SLUG[book.slug];
    if (!key?.startsWith(`${bank.work}/`)) continue;
    for (const chapter of book.chapters) verses.set(`${key.slice(bank.work.length + 1)}:${chapter.number}`, chapter.verses.map(verseText));
  }
  return (book, chapter) => verses.get(`${book}:${chapter}`) ?? null;
}
