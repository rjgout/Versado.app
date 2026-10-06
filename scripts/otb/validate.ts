import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OTB_BOOK_KEY_BY_NUMBER, OTB_BOOKS, OTB_LOCALES, type OtbLocale } from "./bookMapping";
import { normalizeOtbText } from "./normalize";

export interface OngoingIssue {
  locale: string;
  bookKey: string | null;
  chapter: number | null;
  verse: number | null;
  type: string;
  detail: string;
}

export interface LocaleScan {
  locale: OtbLocale;
  books: Map<string, { number: number; name: string; chapters: Map<number, Map<number, string>> }>;
  bookCount: number;
  chapterCount: number;
  versePositionCount: number;
  unlabeledEntryCount: number;
  issues: OngoingIssue[];
}

export interface ValidationResult {
  sourceRoot: string;
  scans: LocaleScan[];
  skeletonsEqual: boolean;
  issues: OngoingIssue[];
}

function issue(locale: string, bookKey: string | null, chapter: number | null, verse: number | null, type: string, detail: string): OngoingIssue {
  return { locale, bookKey, chapter, verse, type, detail };
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...values].sort((a, b) => a - b);
}

function expectedRange(max: number): number[] {
  return Array.from({ length: max }, (_, index) => index + 1);
}

function formatPath(sourceRoot: string, path: string): string {
  return relative(sourceRoot, path) || path;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function scanLocale(sourceRoot: string, locale: OtbLocale): Promise<LocaleScan> {
  const localeRoot = join(sourceRoot, "lang", locale);
  const issues: OngoingIssue[] = [];
  const books = new Map<string, { number: number; name: string; chapters: Map<number, Map<number, string>> }>();
  let unlabeledEntryCount = 0;
  let bookDirectories: string[];

  try {
    bookDirectories = (await readdir(localeRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    issues.push(issue(locale, null, null, null, "missing_locale", `${localeRoot}: ${String(error)}`));
    return { locale, books, bookCount: 0, chapterCount: 0, versePositionCount: 0, unlabeledEntryCount: 0, issues };
  }

  const seenBookNumbers = new Set<number>();
  for (const directory of bookDirectories) {
    const match = /^(\d{2})\.(.+)$/.exec(directory);
    if (!match) {
      issues.push(issue(locale, null, null, null, "invalid_book_directory", directory));
      continue;
    }
    const number = Number(match[1]);
    const bookKey = OTB_BOOK_KEY_BY_NUMBER.get(number);
    if (!bookKey) {
      issues.push(issue(locale, null, null, null, "extra_book", `Upstreamboek ${number}: ${directory}`));
      continue;
    }
    if (seenBookNumbers.has(number)) {
      issues.push(issue(locale, bookKey, null, null, "duplicate_book", directory));
      continue;
    }
    seenBookNumbers.add(number);

    const jsonRoot = join(localeRoot, directory, "json");
    let files: string[] = [];
    try {
      files = (await readdir(jsonRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      issues.push(issue(locale, bookKey, null, null, "missing_json_directory", `${jsonRoot}: ${String(error)}`));
    }

    const chapters = new Map<number, Map<number, string>>();
    let bookName = match[2];
    for (const file of files) {
      const path = join(jsonRoot, file);
      let raw: unknown;
      try {
        raw = await readJson(path);
      } catch (error) {
        issues.push(issue(locale, bookKey, null, null, "invalid_json", `${formatPath(sourceRoot, path)}: ${String(error)}`));
        continue;
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        issues.push(issue(locale, bookKey, null, null, "invalid_chapter_file", formatPath(sourceRoot, path)));
        continue;
      }
      const chapterFile = raw as { chapter?: unknown; book?: unknown; verses?: unknown };
      if (!Number.isInteger(chapterFile.chapter) || typeof chapterFile.book !== "string" || !Array.isArray(chapterFile.verses)) {
        issues.push(issue(locale, bookKey, null, null, "invalid_chapter_file", formatPath(sourceRoot, path)));
        continue;
      }
      const chapterNumber = chapterFile.chapter as number;
      bookName = chapterFile.book;
      if (chapterNumber <= 0) {
        issues.push(issue(locale, bookKey, chapterNumber, null, "invalid_chapter_number", formatPath(sourceRoot, path)));
        continue;
      }
      if (chapters.has(chapterNumber)) {
        issues.push(issue(locale, bookKey, chapterNumber, null, "duplicate_chapter", formatPath(sourceRoot, path)));
        continue;
      }

      const verses = new Map<number, string>();
      for (const rawEntry of chapterFile.verses) {
        const entry = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry)
          ? rawEntry as { verse?: unknown; text?: unknown }
          : null;
        if (!entry || typeof entry !== "object") {
          issues.push(issue(locale, bookKey, chapterNumber, null, "invalid_verse_entry", formatPath(sourceRoot, path)));
          continue;
        }
        if (!("verse" in entry)) {
          // OTB gebruikt dit ook voor psalmopschriften, alfabetletters en
          // historische tekstnotities. Ze zijn geen canonieke verspositie en
          // horen daarom niet in Verse terecht, maar mogen de skeleton niet
          // ongeldig maken.
          try {
            normalizeOtbText(entry.text);
          } catch (error) {
            issues.push(issue(locale, bookKey, chapterNumber, null, "invalid_metadata_text", String(error)));
          }
          unlabeledEntryCount += 1;
          continue;
        }
        const verseNumber = typeof entry.verse === "number" ? entry.verse : null;
        if (verseNumber === null || !Number.isInteger(verseNumber) || verseNumber <= 0) {
          issues.push(issue(locale, bookKey, chapterNumber, verseNumber, "invalid_verse_number", formatPath(sourceRoot, path)));
          continue;
        }
        if (verses.has(verseNumber)) {
          issues.push(issue(locale, bookKey, chapterNumber, verseNumber, "duplicate_verse", formatPath(sourceRoot, path)));
          continue;
        }
        try {
          const text = normalizeOtbText(entry.text);
          if (!text) issues.push(issue(locale, bookKey, chapterNumber, verseNumber, "empty_verse_text", formatPath(sourceRoot, path)));
          verses.set(verseNumber, text);
        } catch (error) {
          issues.push(issue(locale, bookKey, chapterNumber, verseNumber, "invalid_verse_text", `${formatPath(sourceRoot, path)}: ${String(error)}`));
        }
      }
      chapters.set(chapterNumber, verses);
    }

    const chapterNumbers = sortedNumbers(chapters.keys());
    if (chapterNumbers.length > 0) {
      for (const missing of expectedRange(chapterNumbers.at(-1)!)) {
        if (!chapters.has(missing)) issues.push(issue(locale, bookKey, missing, null, "missing_chapter", directory));
      }
    }
    for (const [chapterNumber, verses] of chapters) {
      const verseNumbers = sortedNumbers(verses.keys());
      if (verseNumbers.length === 0) continue;
      for (const missing of expectedRange(verseNumbers.at(-1)!)) {
        if (!verses.has(missing)) issues.push(issue(locale, bookKey, chapterNumber, missing, "missing_verse", directory));
      }
    }
    books.set(bookKey, { number, name: bookName, chapters });
  }

  for (const [number, bookKey] of OTB_BOOKS) {
    if (!seenBookNumbers.has(number)) issues.push(issue(locale, bookKey, null, null, "missing_book", `Verwacht upstreamboek ${number}`));
  }

  const chapterCount = [...books.values()].reduce((total, book) => total + book.chapters.size, 0);
  const versePositionCount = [...books.values()].reduce(
    (total, book) => total + [...book.chapters.values()].reduce((chaptersTotal, verses) => chaptersTotal + verses.size, 0),
    0,
  );
  return { locale, books, bookCount: books.size, chapterCount, versePositionCount, unlabeledEntryCount, issues };
}

export function compareSkeletons(scans: Pick<LocaleScan, "locale" | "books">[]): OngoingIssue[] {
  const skeletons = scans.map((scan) => {
    const positions = new Set<string>();
    for (const [bookKey, book] of scan.books) {
      for (const [chapter, verses] of book.chapters) {
        for (const verse of verses.keys()) positions.add(`${bookKey}.${chapter}.${verse}`);
      }
    }
    return { locale: scan.locale, positions };
  });
  const allPositions = new Set(skeletons.flatMap((scan) => [...scan.positions]));
  const reference = skeletons[0];
  const issues: OngoingIssue[] = [];
  for (const scan of skeletons) {
    for (const position of allPositions) {
      if (scan.positions.has(position) === reference.positions.has(position)) continue;
      const [bookKey, chapter, verse] = position.split(".");
      issues.push(issue(scan.locale, bookKey, Number(chapter), Number(verse), scan.positions.has(position) ? "extra_verse" : "missing_verse", "Skeleton wijkt af van de eerste locale."));
    }
  }
  return issues;
}

export async function validateSource(sourceRoot: string): Promise<ValidationResult> {
  const scans = await Promise.all(OTB_LOCALES.map((locale) => scanLocale(sourceRoot, locale)));
  const issues = scans.flatMap((scan) => scan.issues);
  issues.push(...compareSkeletons(scans));
  return { sourceRoot, scans, skeletonsEqual: issues.length === 0, issues };
}

function printReport(result: ValidationResult): void {
  console.log(`OTB bron: ${result.sourceRoot}`);
  for (const scan of result.scans) {
    console.log(`${scan.locale}: ${scan.bookCount} boeken, ${scan.chapterCount} hoofdstukken, ${scan.versePositionCount} verse positions, ${scan.unlabeledEntryCount} niet-canonieke metadata-items`);
  }
  console.log(`Skeletons exact gelijk: ${result.skeletonsEqual ? "ja" : "nee"}`);
  if (result.issues.length > 0) {
    console.error(`Afwijkingen: ${result.issues.length}`);
    for (const item of result.issues) {
      console.error(`${item.locale} ${item.bookKey ?? "-"} ${item.chapter ?? "-"}:${item.verse ?? "-"} ${item.type}: ${item.detail}`);
    }
  }
}

const sourceFlag = process.argv.indexOf("--source");
const sourceRoot = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : process.env.OTB_SOURCE_DIR;
const execFileAsync = promisify(execFile);

export async function assertPinnedSource(sourceRoot: string): Promise<void> {
  const lock = JSON.parse(await readFile(join(process.cwd(), "scripts/otb/source-lock.json"), "utf8")) as { upstreamCommit: string };
  const { stdout } = await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "HEAD"]);
  const actual = stdout.trim();
  if (actual !== lock.upstreamCommit) {
    throw new Error(`OTB-bron is niet gepind op ${lock.upstreamCommit}; gevonden: ${actual || "geen git-commit"}.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!sourceRoot) {
    console.error("Gebruik: npm run otb:validate -- --source /pad/naar/open-bible");
    process.exitCode = 2;
  } else {
    assertPinnedSource(sourceRoot).then(() => validateSource(sourceRoot)).then((result) => {
      printReport(result);
      process.exitCode = result.skeletonsEqual ? 0 : 1;
    }).catch((error) => {
      console.error(error);
      process.exitCode = 2;
    });
  }
}
