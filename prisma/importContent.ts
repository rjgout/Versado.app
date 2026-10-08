import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { randomUUID } from "crypto";
import {
  generateFillBlank,
  generateWordBank,
  generateTrueFalse,
  buildDistractorPool,
  shuffleWithSeed,
} from "../src/lib/exerciseGen";
import { generateExerciseHint } from "../src/lib/exerciseHints";
import { syncCourses } from "../src/lib/courses";
import { inPhase } from "../src/lib/importPhase";
import type { SeedBook } from "./content";
import { BOOK_KEYS_BY_SLUG } from "./bookKeys";
import { toLanguageCode, type LanguageCode } from "../src/lib/languages";

type ExerciseRow = Prisma.ExerciseCreateManyInput;
type OptionRow = Prisma.QuestionOptionCreateManyInput;

// createMany per blok: één groot blok zou tegen de limiet van Postgres op het
// aantal parameters per query aanlopen.
const CHUNK = 1000;

async function inChunks<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) await write(rows.slice(i, i + CHUNK));
}

/** De automatisch gegenereerde en handgeschreven oefeningen van één hoofdstuk. */
function chapterExercises(
  seedBook: SeedBook,
  seedChapter: SeedBook["chapters"][number],
  chapterId: string,
  verseIds: string[],
  language: LanguageCode
): { exerciseRows: ExerciseRow[]; optionRows: OptionRow[] } {
  // Woordenlijsten en hints in de taal van de uitgave (Nederlands: zoals voorheen).
  const distractorPool = buildDistractorPool(seedChapter.verses, language);

  const exerciseRows: ExerciseRow[] = [];
  const optionRows: OptionRow[] = [];
  let exerciseOrder = 0;

  for (let i = 0; i < seedChapter.verses.length; i++) {
    const verseRef = `${seedBook.name} ${seedChapter.number}:${i + 1}`;
    const sourceVerseId = verseIds[i];

    const fillBlank = generateFillBlank(seedChapter.verses[i], verseRef, i, distractorPool, language);
    if (fillBlank) {
      const exerciseId = randomUUID();
      exerciseRows.push({
        id: exerciseId,
        chapterId,
        order: exerciseOrder++,
        type: fillBlank.type,
        verseRef: fillBlank.verseRef,
        sourceVerseId,
        prompt: fillBlank.prompt,
        answers: JSON.stringify(fillBlank.answers),
        hint: generateExerciseHint(
          fillBlank.type,
          fillBlank.prompt,
          fillBlank.answers,
          fillBlank.verseRef,
          seedChapter.verses[i],
          language
        ),
      });
      fillBlank.options?.forEach((label, order) => {
        optionRows.push({
          id: randomUUID(),
          exerciseId,
          label,
          isCorrect: fillBlank.answers.includes(label.toLowerCase()),
          order,
        });
      });
    }

    if (i % 2 === 0) {
      const wordBank = generateWordBank(seedChapter.verses[i], verseRef, i);
      if (wordBank) {
        exerciseRows.push({
          id: randomUUID(),
          chapterId,
          order: exerciseOrder++,
          type: wordBank.type,
          verseRef: wordBank.verseRef,
          sourceVerseId,
          prompt: wordBank.prompt,
          answers: JSON.stringify(wordBank.answers),
          wordBank: JSON.stringify(wordBank.wordBank),
          hint: generateExerciseHint(
            wordBank.type,
            wordBank.prompt,
            wordBank.answers,
            wordBank.verseRef,
            seedChapter.verses[i],
            language
          ),
        });
      }
    } else {
      const trueFalse = generateTrueFalse(seedChapter.verses[i], verseRef, i, language);
      if (trueFalse) {
        exerciseRows.push({
          id: randomUUID(),
          chapterId,
          order: exerciseOrder++,
          type: trueFalse.type,
          verseRef: trueFalse.verseRef,
          sourceVerseId,
          prompt: trueFalse.prompt,
          answers: JSON.stringify(trueFalse.answers),
          hint: generateExerciseHint(
            trueFalse.type,
            trueFalse.prompt,
            trueFalse.answers,
            trueFalse.verseRef,
            seedChapter.verses[i],
            language
          ),
        });
      }
    }
  }

  // Handmatig geschreven begrijpend-lezen-oefeningen (zie ComprehensionExercise
  // in prisma/content.ts) — kunnen niet automatisch uit de verzen worden
  // afgeleid zoals de rest hierboven.
  for (let c = 0; c < (seedChapter.comprehension ?? []).length; c++) {
    const comp = seedChapter.comprehension![c];
    const exerciseId = randomUUID();
    if (comp.type === "MULTIPLE_CHOICE") {
      exerciseRows.push({
        id: exerciseId,
        chapterId,
        order: exerciseOrder++,
        type: "MULTIPLE_CHOICE",
        verseRef: comp.verseRef,
        prompt: comp.prompt,
        answers: JSON.stringify([comp.options[comp.correctIndex].toLowerCase()]),
        hint: generateExerciseHint(
          "MULTIPLE_CHOICE",
          comp.prompt,
          [comp.options[comp.correctIndex]],
          comp.verseRef,
          undefined,
          language
        ),
      });
      // Geshuffeld, want handmatig geschreven meerkeuzevragen hebben het
      // juiste antwoord vaak als eerste optie genoteerd (leesbaarheid
      // tijdens het schrijven) — zonder shuffle staat het dus (bijna)
      // altijd op dezelfde plek.
      const shuffledOptions = shuffleWithSeed(
        comp.options.map((label, i) => ({ label, isCorrect: i === comp.correctIndex })),
        c + 1
      );
      shuffledOptions.forEach(({ label, isCorrect }, order) => {
        optionRows.push({ id: randomUUID(), exerciseId, label, isCorrect, order });
      });
    } else {
      const shuffled = shuffleWithSeed(comp.items, c + 1);
      exerciseRows.push({
        id: exerciseId,
        chapterId,
        order: exerciseOrder++,
        type: "SEQUENCE",
        verseRef: comp.verseRef,
        prompt: comp.prompt,
        answers: JSON.stringify(comp.items.map((item) => item.toLowerCase())),
        wordBank: JSON.stringify(shuffled),
        hint: generateExerciseHint("SEQUENCE", comp.prompt, comp.items, comp.verseRef, undefined, language),
      });
    }
  }

  return { exerciseRows, optionRows };
}

/**
 * Laadt boeken/hoofdstukken/verzen in de database en genereert er
 * invuloefeningen bij. Idempotent: herdraaien werkt de verzen bij en vervangt
 * de oefeningen van dezelfde hoofdstukken.
 *
 * Verzen worden op hun plek bijgewerkt (zelfde ID, alleen gewijzigde tekst
 * wordt geschreven) in plaats van verwijderd en opnieuw aangemaakt: aan een
 * vers hangen bladwijzers, markeringen en notities van gebruikers, die bij
 * verwijderen mee zouden verdwijnen (cascade).
 *
 * Alles wat er al staat, wordt in één keer opgehaald en alle nieuwe rijen
 * gaan in grote blokken naar de database, in plaats van een handvol
 * round-trips per hoofdstuk. ID's worden zelf gegenereerd, zodat een
 * oefening haar `sourceVerseId` al kent vóór het vers is weggeschreven.
 */
export async function importBooks(
  prisma: PrismaClient,
  books: SeedBook[],
  log: (msg: string) => void = console.log,
  contentCollectionId?: string
) {
  const collection = contentCollectionId
    ? await prisma.contentCollection.findUnique({ where: { id: contentCollectionId }, select: { id: true, language: true } })
    : await prisma.contentCollection.findFirst({
        where: { enabled: true },
        orderBy: { order: "asc" },
        select: { id: true, language: true },
      });
  if (!collection) throw new Error("Geen contentcollectie beschikbaar om boeken aan te koppelen.");
  const collectionId = collection.id;
  const language = toLanguageCode(collection.language);

  const bookIds: string[] = [];
  for (let bookOrder = 0; bookOrder < books.length; bookOrder++) {
    const seedBook = books[bookOrder];
    const key = seedBook.key ?? BOOK_KEYS_BY_SLUG[seedBook.slug] ?? null;
    const book = await prisma.book.upsert({
      where: { slug: seedBook.slug },
      update: { name: seedBook.name, order: bookOrder, contentCollectionId: collectionId, key },
      create: { slug: seedBook.slug, name: seedBook.name, order: bookOrder, contentCollectionId: collectionId, key },
    });
    bookIds.push(book.id);
  }

  const existingChapters = await prisma.chapter.findMany({
    where: { bookId: { in: bookIds } },
    select: { id: true, bookId: true, number: true, order: true, heading: true, verses: { select: { id: true, number: true, text: true } } },
  });
  const chapterByKey = new Map(existingChapters.map((c) => [`${c.bookId}:${c.number}`, c]));

  const chapterCreates: Prisma.ChapterCreateManyInput[] = [];
  const chapterUpdates: { id: string; order: number; heading: string | null }[] = [];
  const verseCreates: Prisma.VerseCreateManyInput[] = [];
  const verseUpdates: { id: string; text: string }[] = [];
  const verseDeletes: string[] = [];
  const exerciseRows: ExerciseRow[] = [];
  const optionRows: OptionRow[] = [];
  const chapterIds: string[] = [];

  books.forEach((seedBook, bookIndex) => {
    const bookId = bookIds[bookIndex];
    let bookExercises = 0;
    seedBook.chapters.forEach((seedChapter, chapterOrder) => {
      const heading = seedChapter.heading ?? null;
      const existing = chapterByKey.get(`${bookId}:${seedChapter.number}`);
      const chapterId = existing?.id ?? randomUUID();
      chapterIds.push(chapterId);
      if (!existing) {
        chapterCreates.push({ id: chapterId, bookId, number: seedChapter.number, order: chapterOrder, heading });
      } else if (existing.order !== chapterOrder || existing.heading !== heading) {
        chapterUpdates.push({ id: chapterId, order: chapterOrder, heading });
      }

      const versesByNumber = new Map((existing?.verses ?? []).map((v) => [v.number, v]));
      const verseIds = seedChapter.verses.map((text, i) => {
        const current = versesByNumber.get(i + 1);
        if (!current) {
          const id = randomUUID();
          verseCreates.push({ id, chapterId, number: i + 1, text });
          return id;
        }
        if (current.text !== text) verseUpdates.push({ id: current.id, text });
        return current.id;
      });
      for (const verse of existing?.verses ?? []) {
        if (verse.number > seedChapter.verses.length) verseDeletes.push(verse.id);
      }

      const generated = chapterExercises(seedBook, seedChapter, chapterId, verseIds, language);
      exerciseRows.push(...generated.exerciseRows);
      optionRows.push(...generated.optionRows);
      bookExercises += generated.exerciseRows.length;
    });
    log(`  - ${seedBook.name}: ${seedBook.chapters.length} hoofdstukken, ${bookExercises} oefeningen`);
  });

  await inChunks(chapterCreates, (data) => prisma.chapter.createMany({ data }));
  for (const c of chapterUpdates) {
    await prisma.chapter.update({ where: { id: c.id }, data: { order: c.order, heading: c.heading } });
  }
  await inChunks(verseCreates, (data) => prisma.verse.createMany({ data }));
  await inChunks(verseUpdates, (chunk) =>
    prisma.$transaction(chunk.map((v) => prisma.verse.update({ where: { id: v.id }, data: { text: v.text } })))
  );
  log(`  Verzen: ${verseCreates.length} nieuw, ${verseUpdates.length} gewijzigd, ${verseDeletes.length} verwijderd.`);

  // In één transactie: er is geen moment waarop een hoofdstuk even zonder
  // oefeningen zit, en een fout halverwege laat de oude oefeningen staan.
  await prisma.$transaction(
    async (tx) => {
      await tx.exercise.deleteMany({ where: { chapterId: { in: chapterIds } } });
      await inChunks(exerciseRows, (data) => tx.exercise.createMany({ data }));
      await inChunks(optionRows, (data) => tx.questionOption.createMany({ data }));
    },
    { maxWait: 30_000, timeout: 10 * 60_000 }
  );
  // Pas na de nieuwe oefeningen: die verwijzen alleen nog naar bestaande verzen.
  if (verseDeletes.length > 0) await prisma.verse.deleteMany({ where: { id: { in: verseDeletes } } });

  await inPhase("Cursussen", () => syncCourses(prisma));
}
