import { normalizeOtbText } from "./normalize";

export interface ParsedOtbMetadata {
  kind: "separator" | "metadata";
  text: string;
}

export interface ParsedOtbChapter {
  book: string;
  chapter: number;
  verses: Map<number, string>;
  metadata: ParsedOtbMetadata[];
  issues: { type: string; verse: number | null; detail: string }[];
}

/** Eén interpretatie van OTB-hoofdstukitems voor validator én importer. */
export function parseOtbChapter(raw: unknown, context = "OTB-hoofdstuk"): ParsedOtbChapter {
  const issues: ParsedOtbChapter["issues"] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { book: "", chapter: 0, verses: new Map(), metadata: [], issues: [{ type: "invalid_chapter_file", verse: null, detail: context }] };
  }
  const value = raw as { book?: unknown; chapter?: unknown; verses?: unknown };
  if (typeof value.book !== "string" || !Number.isInteger(value.chapter) || !Array.isArray(value.verses)) {
    return { book: typeof value.book === "string" ? value.book : "", chapter: typeof value.chapter === "number" ? value.chapter : 0, verses: new Map(), metadata: [], issues: [{ type: "invalid_chapter_file", verse: null, detail: context }] };
  }
  const chapterNumber = value.chapter as number;

  const verses = new Map<number, string>();
  const metadata: ParsedOtbMetadata[] = [];
  for (const rawEntry of value.verses) {
    const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)
      ? rawEntry as { verse?: unknown; text?: unknown }
      : null;
    if (!entry) {
      issues.push({ type: "invalid_verse_entry", verse: null, detail: context });
      continue;
    }
    if (!("verse" in entry)) {
      try {
        const text = normalizeOtbText(entry.text);
        metadata.push({ kind: text === "---" ? "separator" : "metadata", text });
      } catch (error) {
        issues.push({ type: "invalid_metadata_text", verse: null, detail: `${context}: ${String(error)}` });
      }
      continue;
    }
    const verseNumber = typeof entry.verse === "number" ? entry.verse : null;
    if (verseNumber === null || !Number.isInteger(verseNumber) || verseNumber <= 0) {
      issues.push({ type: "invalid_verse_number", verse: verseNumber, detail: context });
      continue;
    }
    if (verses.has(verseNumber)) {
      issues.push({ type: "duplicate_verse", verse: verseNumber, detail: context });
      continue;
    }
    try {
      const text = normalizeOtbText(entry.text);
      if (!text) issues.push({ type: "empty_verse_text", verse: verseNumber, detail: context });
      verses.set(verseNumber, text);
    } catch (error) {
      issues.push({ type: "invalid_verse_text", verse: verseNumber, detail: `${context}: ${String(error)}` });
    }
  }
  return { book: value.book, chapter: chapterNumber, verses, metadata, issues };
}
