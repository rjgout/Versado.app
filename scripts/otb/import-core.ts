import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { OTB_BOOK_KEY_BY_NUMBER, OTB_LANGUAGE_BY_LOCALE, OTB_LOCALES, type OtbLocale } from "./bookMapping";
import { parseOtbChapter, type ParsedOtbChapter } from "./chapterParser";
import { assertPinnedSource, validateSource } from "./validate";
import { OTB_BOOK_NUMBERS, OTB_COLLECTIONS, otbWorkForBookNumber, type OtbWork } from "./trialConfig";
import { otbCollectionName } from "./collectionNames";

export interface OtbImportProgress {
  current: number;
  total: number;
  label: string;
  work: OtbWork;
  language: string;
  bookNumber: number;
  bookCount: number;
  chapterNumber: number;
  chapterCount: number;
}

type ProgressCallback = (progress: OtbImportProgress) => void;

/** Leest één locale één keer; writes blijven per hoofdstuk klein en hervatbaar. */
async function readLocale(sourceRoot: string, locale: OtbLocale): Promise<Map<number, Map<number, ParsedOtbChapter>>> {
  const localeRoot = join(sourceRoot, "lang", locale);
  const result = new Map<number, Map<number, ParsedOtbChapter>>();
  const directories = (await readdir(localeRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const bookNumber of OTB_BOOK_NUMBERS) {
    const directory = directories.find((entry) => entry.startsWith(`${String(bookNumber).padStart(2, "0")}.`));
    if (!directory) throw new Error(`Geen OTB-boek ${bookNumber} voor ${locale}.`);
    const jsonRoot = join(localeRoot, directory, "json");
    const files = (await readdir(jsonRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    const chapters = new Map<number, ParsedOtbChapter>();
    for (const file of files) {
      const parsed = parseOtbChapter(JSON.parse(await readFile(join(jsonRoot, file), "utf8")), `${locale} boek ${bookNumber} (${file})`);
      if (parsed.issues.length > 0) {
        throw new Error(`OTB-hoofdstuk bevat ongeldige data (${locale}, boek ${bookNumber}, ${file}): ${parsed.issues.map((item) => item.type).join(", ")}.`);
      }
      if (chapters.has(parsed.chapter)) throw new Error(`Dubbel OTB-hoofdstuk (${locale}, boek ${bookNumber}, hoofdstuk ${parsed.chapter}).`);
      chapters.set(parsed.chapter, parsed);
    }
    result.set(bookNumber, chapters);
  }
  return result;
}

async function upsertCollection(client: PrismaClient, collection: typeof OTB_COLLECTIONS[number], sourceUrl: string, license: string, licenseUrl: string): Promise<void> {
  await client.contentCollection.upsert({
    where: { id: collection.id },
    update: {
      slug: collection.slug, name: otbCollectionName(collection.work, collection.language), icon: "📖", order: collection.order,
      enabled: true, visibleToUsers: false, work: collection.work, editionKey: collection.editionKey, language: collection.language,
      sourceName: "Open Translation Bible", sourceUrl, licenseName: license, licenseUrl,
    },
    create: {
      id: collection.id, slug: collection.slug, name: otbCollectionName(collection.work, collection.language), icon: "📖", order: collection.order,
      enabled: true, visibleToUsers: false, work: collection.work, editionKey: collection.editionKey, language: collection.language,
      sourceName: "Open Translation Bible", sourceUrl, licenseName: license, licenseUrl,
    },
  });
}

/** Importeert de volledige gepinde OTB-bron in hoofdstukbatches. */
export async function importOtbFull(
  client: PrismaClient,
  sourceRoot: string,
  log: (message: string) => void = console.log,
  onProgress?: ProgressCallback,
): Promise<void> {
  log("OTB-bronversie controleren...");
  await assertPinnedSource(sourceRoot);
  log("Bijbelstructuur valideren...");
  const validation = await validateSource(sourceRoot);
  if (!validation.skeletonsEqual || validation.issues.length > 0) {
    throw new Error(`OTB-validatie faalt: ${validation.issues.length} afwijkingen; er is niets geïmporteerd.`);
  }

  const lock = JSON.parse(await readFile(join(process.cwd(), "scripts/otb/source-lock.json"), "utf8")) as {
    upstreamCommit: string;
    license: string;
    licenseUrl: string;
  };
  const totalChapters = validation.scans[0]?.chapterCount ?? 0;
  const totalImportChapters = validation.scans.reduce((total, scan) => total + scan.chapterCount, 0);
  let completedChapters = 0;

  for (const locale of OTB_LOCALES) {
    const chaptersByBook = await readLocale(sourceRoot, locale);
    const language = OTB_LANGUAGE_BY_LOCALE[locale];
    for (const collection of OTB_COLLECTIONS.filter((item) => item.locale === locale)) {
      const sourceUrl = `https://github.com/OpenTranslationBible/open-bible/tree/${lock.upstreamCommit}/lang/${collection.locale}`;
      await upsertCollection(client, collection, sourceUrl, lock.license, lock.licenseUrl);
      const bookNumbers = OTB_BOOK_NUMBERS.filter((number) => otbWorkForBookNumber(number) === collection.work);
      log(`${collection.work === "old-testament" ? "Oude Testament" : "Nieuwe Testament"} — ${language}: ${bookNumbers.length} boeken laden...`);

      for (const [bookIndex, bookNumber] of bookNumbers.entries()) {
        const chapters = chaptersByBook.get(bookNumber);
        if (!chapters) throw new Error(`Geen hoofdstukken voor OTB-boek ${bookNumber} (${locale}).`);
        const bookKey = OTB_BOOK_KEY_BY_NUMBER.get(bookNumber)!;
        const bookInfo = validation.scans.find((scan) => scan.locale === locale)?.books.get(bookKey);
        const bookName = bookInfo?.name ?? chapters.values().next().value?.book ?? bookKey;
        log(`${collection.work === "old-testament" ? "Oude Testament" : "Nieuwe Testament"} — ${language}: boek ${bookIndex + 1}/${bookNumbers.length}: ${bookName}`);

        for (const chapterNumber of [...chapters.keys()].sort((a, b) => a - b)) {
          const chapter = chapters.get(chapterNumber)!;
          completedChapters += 1;
          onProgress?.({
            current: completedChapters,
            total: totalImportChapters,
            label: `${bookName} ${chapterNumber}`,
            work: collection.work,
            language,
            bookNumber,
            bookCount: bookNumbers.length,
            chapterNumber,
            chapterCount: chapters.size,
          });

          // Elke hoofdstukbatch is atomair; eerdere batches blijven staan en
          // een volgende reload kan ontbrekende batches veilig aanvullen.
          await client.$transaction(async (tx) => {
            const book = await tx.book.upsert({
              where: { slug: `${collection.work}-otb-${collection.language}-${bookKey}` },
              update: { name: bookName, order: bookNumber - 1, key: bookKey, contentCollectionId: collection.id },
              create: { slug: `${collection.work}-otb-${collection.language}-${bookKey}`, name: bookName, order: bookNumber - 1, contentCollectionId: collection.id, key: bookKey },
            });
            const chapterRow = await tx.chapter.upsert({
              where: { bookId_number: { bookId: book.id, number: chapter.chapter } },
              update: { order: chapter.chapter - 1 },
              create: { bookId: book.id, number: chapter.chapter, order: chapter.chapter - 1 },
            });
            const existingVerses = await tx.verse.findMany({ where: { chapterId: chapterRow.id }, select: { id: true, number: true, text: true } });
            const existingByNumber = new Map(existingVerses.map((verse) => [verse.number, verse]));
            const missingVerses: { chapterId: string; number: number; text: string }[] = [];
            for (const [verseNumber, text] of chapter.verses) {
              if (!Number.isInteger(verseNumber) || verseNumber <= 0 || !text) {
                throw new Error(`Ongeldig OTB-vers vóór databasewrite (${locale}, ${bookKey}, ${chapter.chapter}:${verseNumber}).`);
              }
              const existing = existingByNumber.get(verseNumber);
              if (existing) {
                if (existing.text !== text) await tx.verse.update({ where: { id: existing.id }, data: { text } });
              } else {
                missingVerses.push({ chapterId: chapterRow.id, number: verseNumber, text });
              }
            }
            // Eén batchinsert per hoofdstuk voorkomt honderdduizenden losse
            // writes bij de eerste volledige import. Bestaande records worden
            // hierboven gericht bijgewerkt, zodat hun IDs en audiovelden intact
            // blijven.
            if (missingVerses.length > 0) await tx.verse.createMany({ data: missingVerses });
          });
        }
      }
    }
  }
  log(`OTB-content bijgewerkt: ${totalChapters * OTB_LOCALES.length} hoofdstukken verwerkt.`);
}

// De CLI-naam blijft bestaan voor de bestaande workflow; de inhoud is nu volledig.
export const importOtbTrial = importOtbFull;
