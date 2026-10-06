import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "../../src/generated/prisma/client";
import { OTB_BOOK_KEY_BY_NUMBER, OTB_LOCALES, type OtbLocale } from "./bookMapping";
import { normalizeOtbText } from "./normalize";
import { assertPinnedSource, validateSource } from "./validate";
import { OTB_TRIAL_BOOK_NUMBERS, OTB_TRIAL_COLLECTIONS, otbWorkForBookNumber } from "./trialConfig";
import { otbCollectionName } from "./collectionNames";

interface OtbChapter {
  book: string;
  chapter: number;
  verses: { verse: number; text: unknown }[];
}

async function readTrialChapter(sourceRoot: string, locale: OtbLocale, bookNumber: number, chapterNumber: number): Promise<OtbChapter> {
  const localeRoot = join(sourceRoot, "lang", locale);
  const directories = await readdir(localeRoot, { withFileTypes: true });
  const directory = directories.find((entry) => entry.isDirectory() && entry.name.startsWith(`${String(bookNumber).padStart(2, "0")}.`));
  if (!directory) throw new Error(`Geen OTB-boek ${bookNumber} voor ${locale}.`);
  const jsonRoot = join(localeRoot, directory.name, "json");
  const files = (await readdir(jsonRoot)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const chapter = JSON.parse(await readFile(join(jsonRoot, file), "utf8")) as OtbChapter;
    if (chapter.chapter === chapterNumber) return chapter;
  }
  throw new Error(`Geen OTB-hoofdstuk ${bookNumber}:${chapterNumber} voor ${locale}.`);
}

export async function importOtbTrial(client: PrismaClient, sourceRoot: string, log: (message: string) => void = console.log): Promise<void> {
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
  const chapters = new Map<string, OtbChapter>();
  for (const locale of OTB_LOCALES) {
    for (const bookNumber of OTB_TRIAL_BOOK_NUMBERS) {
      const chapter = await readTrialChapter(sourceRoot, locale, bookNumber, bookNumber === 19 ? 23 : 1);
      chapters.set(`${locale}:${bookNumber}`, chapter);
    }
  }

  await client.$transaction(async (tx) => {
    for (const collection of OTB_TRIAL_COLLECTIONS) {
    const sourceUrl = `https://github.com/OpenTranslationBible/open-bible/tree/${lock.upstreamCommit}/lang/${collection.locale}`;
    log(`${collection.work === "old-testament" ? "Oude Testament" : "Nieuwe Testament"} (${collection.language}) importeren...`);
    await tx.contentCollection.upsert({
      where: { id: collection.id },
      update: {
        slug: collection.slug, name: otbCollectionName(collection.work, collection.language), icon: "📖", order: collection.order,
        enabled: true, visibleToUsers: collection.visibleToUsers, work: collection.work, editionKey: collection.editionKey,
        language: collection.language, sourceName: "Open Translation Bible", sourceUrl, licenseName: lock.license, licenseUrl: lock.licenseUrl,
      },
      create: {
        id: collection.id, slug: collection.slug, name: otbCollectionName(collection.work, collection.language), icon: "📖", order: collection.order,
        enabled: true, visibleToUsers: collection.visibleToUsers, work: collection.work, editionKey: collection.editionKey,
        language: collection.language, sourceName: "Open Translation Bible", sourceUrl, licenseName: lock.license, licenseUrl: lock.licenseUrl,
      },
    });

    for (const bookNumber of OTB_TRIAL_BOOK_NUMBERS.filter((number) => otbWorkForBookNumber(number) === collection.work)) {
      const chapter = chapters.get(`${collection.locale}:${bookNumber}`)!;
      const bookKey = OTB_BOOK_KEY_BY_NUMBER.get(bookNumber)!;
      const book = await tx.book.upsert({
        where: { slug: `${collection.work}-otb-${collection.language}-${bookKey}` },
        update: { name: chapter.book, order: bookNumber - 1, key: bookKey, contentCollectionId: collection.id },
        create: { slug: `${collection.work}-otb-${collection.language}-${bookKey}`, name: chapter.book, order: bookNumber - 1, contentCollectionId: collection.id, key: bookKey },
      });
      const chapterRow = await tx.chapter.upsert({
        where: { bookId_number: { bookId: book.id, number: chapter.chapter } },
        update: { order: chapter.chapter - 1 },
        create: { bookId: book.id, number: chapter.chapter, order: chapter.chapter - 1 },
      });
      for (const verse of chapter.verses) {
        await tx.verse.upsert({
          where: { chapterId_number: { chapterId: chapterRow.id, number: verse.verse } },
          update: { text: normalizeOtbText(verse.text), audioStart: null },
          create: { chapterId: chapterRow.id, number: verse.verse, text: normalizeOtbText(verse.text) },
        });
      }
    }
    }
  });
  log("OTB-content bijgewerkt.");
}
