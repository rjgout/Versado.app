import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createPrismaClient } from "../../src/lib/db";
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

async function main(): Promise<void> {
  const sourceFlag = process.argv.indexOf("--source");
  const sourceRoot = sourceFlag >= 0 ? process.argv[sourceFlag + 1] : process.env.OTB_SOURCE_DIR;
  if (!sourceRoot) throw new Error("Gebruik: npm run otb:import-trial -- --source /pad/naar/open-bible");
  const lock = JSON.parse(await readFile(join(process.cwd(), "scripts/otb/source-lock.json"), "utf8")) as {
    upstreamCommit: string;
    license: string;
    licenseUrl: string;
  };
  await assertPinnedSource(sourceRoot);

  // De volledige gate draait vóór de Prisma-client wordt gemaakt en dus vóór
  // elke mogelijkheid om een databasewrite uit te voeren.
  const validation = await validateSource(sourceRoot);
  if (!validation.skeletonsEqual) {
    throw new Error(`OTB-validatie faalt: ${validation.issues.length} afwijkingen; proefimport afgebroken.`);
  }

  const chapters = new Map<string, OtbChapter>();
  for (const locale of OTB_LOCALES) {
    for (const bookNumber of OTB_TRIAL_BOOK_NUMBERS) {
      const chapter = await readTrialChapter(sourceRoot, locale, bookNumber, bookNumber === 19 ? 23 : 1);
      chapters.set(`${locale}:${bookNumber}`, chapter);
    }
  }

  const prisma = createPrismaClient();
  try {
    for (const collection of OTB_TRIAL_COLLECTIONS) {
      const sourceUrl = `https://github.com/OpenTranslationBible/open-bible/tree/${lock.upstreamCommit}/lang/${collection.locale}`;
      await prisma.contentCollection.upsert({
        where: { id: collection.id },
        update: {
          slug: collection.slug,
          name: otbCollectionName(collection.work, collection.language),
          icon: "📖",
          order: collection.order,
          enabled: true,
          visibleToUsers: collection.visibleToUsers,
          work: collection.work,
          editionKey: collection.editionKey,
          language: collection.language,
          sourceName: "Open Translation Bible",
          sourceUrl,
          licenseName: lock.license,
          licenseUrl: lock.licenseUrl,
        },
        create: {
          id: collection.id,
          slug: collection.slug,
          name: otbCollectionName(collection.work, collection.language),
          icon: "📖",
          order: collection.order,
          enabled: true,
          visibleToUsers: collection.visibleToUsers,
          work: collection.work,
          editionKey: collection.editionKey,
          language: collection.language,
          sourceName: "Open Translation Bible",
          sourceUrl,
          licenseName: lock.license,
          licenseUrl: lock.licenseUrl,
        },
      });

      for (const bookNumber of OTB_TRIAL_BOOK_NUMBERS.filter((number) => otbWorkForBookNumber(number) === collection.work)) {
        const chapter = chapters.get(`${collection.locale}:${bookNumber}`)!;
        const bookKey = OTB_BOOK_KEY_BY_NUMBER.get(bookNumber)!;
        const book = await prisma.book.upsert({
          where: { slug: `${collection.work}-otb-${collection.language}-${bookKey}` },
          update: { name: chapter.book, order: bookNumber - 1, key: bookKey, contentCollectionId: collection.id },
          create: { slug: `${collection.work}-otb-${collection.language}-${bookKey}`, name: chapter.book, order: bookNumber - 1, key: bookKey, contentCollectionId: collection.id },
        });
        const chapterRow = await prisma.chapter.upsert({
          where: { bookId_number: { bookId: book.id, number: chapter.chapter } },
          update: { order: chapter.chapter - 1 },
          create: { bookId: book.id, number: chapter.chapter, order: chapter.chapter - 1 },
        });
        for (const verse of chapter.verses) {
          await prisma.verse.upsert({
            where: { chapterId_number: { chapterId: chapterRow.id, number: verse.verse } },
            update: { text: normalizeOtbText(verse.text), audioStart: null },
            create: { chapterId: chapterRow.id, number: verse.verse, text: normalizeOtbText(verse.text) },
          });
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log("OTB-proefimport klaar: 10 verborgen collecties, Genesis 1, Psalm 23 en Johannes 1.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
