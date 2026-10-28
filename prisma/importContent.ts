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
import { exerciseSignature, optionsFingerprint, planExerciseSync } from "../src/lib/exerciseSync";
import { flagAudioForTextChanges, type AudioFlagStats, type AudioTextChange } from "../src/lib/audioCheck";
import { BOM_COLLECTION_ID } from "../src/lib/contentCollectionIds";
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

export interface BooksImportStats {
  chapters: { created: number; updated: number };
  verses: { created: number; updated: number; deleted: number };
  exercises: ExerciseSyncStats;
  audio: AudioFlagStats;
  /** Alleen de hoofdstukken waar iets verandert (leeg bij een ongewijzigde bron): voor de controle- en voorbereidingsstap. */
  changes: ChapterChange[];
  dryRun: boolean;
}

export interface ChapterChange {
  bookSlug: string;
  bookName: string;
  chapter: number;
  isNew: boolean;
  verses: { created: number; updated: number; deleted: number; changedNumbers: number[] };
  exercises: { kept: number; created: number; retired: number; deleted: number };
  /** Heeft dit hoofdstuk voorgelezen audio die bij de oude tekst hoort? Dan wordt het na publicatie als NEEDS_REVIEW aangemerkt. */
  audioAffected: boolean;
}

export interface ExerciseSyncStats {
  kept: number;
  updated: number;
  created: number;
  /** Buiten gebruik gesteld omdat iemand ze al kreeg of beantwoordde (status RETIRED, niet verwijderd). */
  retired: number;
  /** Verwijderd omdat niemand ze ooit kreeg. */
  deleted: number;
  /** Per hoofdstuk, alleen gevuld bij wijzigingen. */
  perChapter?: Map<string, { kept: number; created: number; retired: number; deleted: number }>;
}

/**
 * Brengt de oefeningen van de opgegeven hoofdstukken in overeenstemming met de gegenereerde set, zonder ongewijzigde
 * oefeningen aan te raken (zie exerciseSync.ts). Eén transactie: een fout laat de oude oefeningen volledig staan.
 */
/** Oefeningen waar een gebruiker al mee bezig was: een antwoordpoging, een XP-bijschrijving of een open oefenset die haar bevat. */
async function usedExerciseIds(db: PrismaClient, ids: string[], chapterIds: string[]): Promise<Set<string>> {
  const used = new Set<string>();
  if (ids.length === 0) return used;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    for (const row of await db.exerciseAttempt.findMany({ where: { exerciseId: { in: part } }, select: { exerciseId: true }, distinct: ["exerciseId"] })) used.add(row.exerciseId);
    for (const row of await db.contentExerciseCredit.findMany({ where: { exerciseId: { in: part } }, select: { exerciseId: true }, distinct: ["exerciseId"] })) used.add(row.exerciseId);
  }
  const wanted = new Set(ids);
  for (const session of await db.exerciseSession.findMany({ where: { submittedAt: null, chapterId: { in: chapterIds } }, select: { exerciseIds: true } })) {
    for (const id of JSON.parse(session.exerciseIds) as string[]) if (wanted.has(id)) used.add(id);
  }
  return used;
}

async function syncChapterExercises(
  prisma: PrismaClient,
  generatedByChapter: Map<string, { exerciseRows: ExerciseRow[]; optionRows: OptionRow[] }>,
  dryRun = false
): Promise<ExerciseSyncStats> {
  const chapterIds = [...generatedByChapter.keys()];
  const stats: ExerciseSyncStats = { kept: 0, updated: 0, created: 0, retired: 0, deleted: 0 };

  const existingRows: {
    id: string; chapterId: string; order: number; status: string; hint: string | null; sourceVerseId: string | null; signature: string; options: string;
  }[] = [];
  for (let i = 0; i < chapterIds.length; i += 500) {
    const rows = await prisma.exercise.findMany({
      where: { chapterId: { in: chapterIds.slice(i, i + 500) }, status: "APPROVED" },
      orderBy: [{ chapterId: "asc" }, { order: "asc" }],
      include: { options: { orderBy: { order: "asc" }, select: { label: true, isCorrect: true } } },
    });
    for (const row of rows) {
      if (!row.chapterId) continue;
      existingRows.push({ id: row.id, chapterId: row.chapterId, order: row.order, status: row.status, hint: row.hint, sourceVerseId: row.sourceVerseId, signature: exerciseSignature(row), options: optionsFingerprint(row.options) });
    }
  }
  const existingByChapter = new Map<string, typeof existingRows>();
  for (const row of existingRows) {
    const list = existingByChapter.get(row.chapterId) ?? [];
    list.push(row);
    existingByChapter.set(row.chapterId, list);
  }

  const perChapter = new Map<string, { kept: number; created: number; retired: number; deleted: number }>();
  const bump = (chapterId: string, key: "kept" | "created" | "retired" | "deleted") => {
    const row = perChapter.get(chapterId) ?? { kept: 0, created: 0, retired: 0, deleted: 0 };
    row[key]++;
    perChapter.set(chapterId, row);
  };
  const creates: ExerciseRow[] = [];
  const createdOptions: OptionRow[] = [];
  const updates: { id: string; order: number; hint: string | null; sourceVerseId: string | null }[] = [];
  const optionReplacements: { exerciseId: string; options: OptionRow[] }[] = [];
  const unmatched: string[] = [];

  for (const [chapterId, generated] of generatedByChapter) {
    const optionsByExercise = new Map<string, OptionRow[]>();
    for (const option of generated.optionRows) {
      const list = optionsByExercise.get(option.exerciseId) ?? [];
      list.push(option);
      optionsByExercise.set(option.exerciseId, list);
    }
    const orderedOptions = (id: string) => (optionsByExercise.get(id) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((o) => ({ label: o.label, isCorrect: o.isCorrect ?? false }));
    const desiredSignatures = generated.exerciseRows.map((row) =>
      exerciseSignature({ type: row.type, verseRef: row.verseRef, prompt: row.prompt, answers: row.answers, wordBank: row.wordBank, options: orderedOptions(row.id!) })
    );
    const plan = planExerciseSync(existingByChapter.get(chapterId) ?? [], desiredSignatures);
    generated.exerciseRows.forEach((row, index) => {
      const keep = plan.keep[index];
      if (!keep) {
        bump(chapterId, "created");
        creates.push(row);
        createdOptions.push(...(optionsByExercise.get(row.id!) ?? []));
        return;
      }
      stats.kept++;
      bump(chapterId, "kept");
      // Dezelfde vraag, andere afleiders: de opties van deze oefening vervangen, het id en alles wat eraan hangt blijft.
      if (keep.options !== optionsFingerprint(orderedOptions(row.id!))) {
        optionReplacements.push({ exerciseId: keep.id, options: (optionsByExercise.get(row.id!) ?? []).map((o) => ({ ...o, exerciseId: keep.id })) });
      }
      const hint = (row.hint as string | null | undefined) ?? null;
      const sourceVerseId = (row.sourceVerseId as string | null | undefined) ?? null;
      if (keep.order !== row.order || keep.hint !== hint || keep.sourceVerseId !== sourceVerseId) {
        updates.push({ id: keep.id, order: row.order, hint, sourceVerseId });
      }
    });
    unmatched.push(...plan.unmatched.map((row) => row.id));
  }

  // Wie is al aan een oefening begonnen? Dan blijft ze bestaan (buiten gebruik); anders kan ze veilig weg.
  const used = await usedExerciseIds(prisma, unmatched, chapterIds);
  const retire = unmatched.filter((id) => used.has(id));
  const remove = unmatched.filter((id) => !used.has(id));
  const chapterOf = new Map(existingRows.map((row) => [row.id, row.chapterId]));
  for (const id of retire) bump(chapterOf.get(id)!, "retired");
  for (const id of remove) bump(chapterOf.get(id)!, "deleted");

  stats.updated = new Set([...updates.map((u) => u.id), ...optionReplacements.map((r) => r.exerciseId)]).size;
  stats.created = creates.length;
  stats.retired = retire.length;
  stats.deleted = remove.length;
  const changedChapters = new Map([...perChapter].filter(([, row]) => row.created + row.retired + row.deleted > 0));
  if (changedChapters.size > 0) stats.perChapter = changedChapters;
  if (dryRun || updates.length + optionReplacements.length + creates.length + retire.length + remove.length === 0) return stats;

  await prisma.$transaction(
    async (tx) => {
      if (retire.length > 0) await inChunks(retire, (ids) => tx.exercise.updateMany({ where: { id: { in: ids } }, data: { status: "RETIRED" } }));
      if (remove.length > 0) await inChunks(remove, (ids) => tx.exercise.deleteMany({ where: { id: { in: ids } } }));
      for (const update of updates) await tx.exercise.update({ where: { id: update.id }, data: { order: update.order, hint: update.hint, sourceVerseId: update.sourceVerseId } });
      if (optionReplacements.length > 0) {
        await inChunks(optionReplacements.map((r) => r.exerciseId), (ids) => tx.questionOption.deleteMany({ where: { exerciseId: { in: ids } } }));
        await inChunks(optionReplacements.flatMap((r) => r.options), (data) => tx.questionOption.createMany({ data }));
      }
      await inChunks(creates, (data) => tx.exercise.createMany({ data }));
      await inChunks(createdOptions, (data) => tx.questionOption.createMany({ data }));
    },
    { maxWait: 30_000, timeout: 10 * 60_000 }
  );
  return stats;
}

/**
 * Laadt boeken/hoofdstukken/verzen in de database en genereert er
 * invuloefeningen bij. Idempotent én inhoudsgestuurd: herdraaien met dezelfde
 * bron verandert niets (geen enkel id, geen enkele rij).
 *
 * Verzen worden op hun plek bijgewerkt (zelfde ID, alleen gewijzigde tekst
 * wordt geschreven) in plaats van verwijderd en opnieuw aangemaakt: aan een
 * vers hangen bladwijzers, markeringen en notities van gebruikers, die bij
 * verwijderen mee zouden verdwijnen (cascade).
 *
 * Oefeningen volgen dezelfde regel (src/lib/exerciseSync.ts): een oefening met
 * ongewijzigde inhoud behoudt haar id, haar opties, haar antwoordgeschiedenis,
 * haar XP-bijschrijving en haar plek in elke uitgedeelde oefenset. Alleen wat
 * inhoudelijk anders is wordt nieuw aangemaakt; een verdwenen of gewijzigde
 * oefening wordt verwijderd als niemand haar gebruikte, en anders buiten
 * gebruik gesteld (status RETIRED, dus nooit meer uitgedeeld) maar niet
 * gewist, zodat wie haar al kreeg haar nog kan afronden en niets verdwijnt.
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
  contentCollectionId?: string,
  options: { syncCourses?: boolean; dryRun?: boolean } = {}
): Promise<BooksImportStats> {
  const dryRun = options.dryRun === true;
  // Zonder expliciete doelcollectie geldt het Boek van Mormon (vast id); nooit "de eerste ingeschakelde collectie op volgorde": bij gelijke
  // `order` is dat een toevallige andere collectie (zie docs/CURSUSIDENTITEIT.md).
  const collection = await prisma.contentCollection.findUnique({ where: { id: contentCollectionId ?? BOM_COLLECTION_ID }, select: { id: true, language: true } });
  if (!collection) throw new Error(`Contentcollectie ${contentCollectionId ?? BOM_COLLECTION_ID} bestaat niet; boeken worden niet gekoppeld.`);
  const collectionId = collection.id;
  const language = toLanguageCode(collection.language);

  // Een droogloop (controleren/voorbereiden) schrijft nooit: een nog niet bestaand boek telt dan als geheel nieuw.
  const bookIds: string[] = [];
  for (let bookOrder = 0; bookOrder < books.length; bookOrder++) {
    const seedBook = books[bookOrder];
    const key = seedBook.key ?? BOOK_KEYS_BY_SLUG[seedBook.slug] ?? null;
    if (dryRun) {
      bookIds.push((await prisma.book.findUnique({ where: { slug: seedBook.slug }, select: { id: true } }))?.id ?? `nieuw:${seedBook.slug}`);
      continue;
    }
    const book = await prisma.book.upsert({
      where: { slug: seedBook.slug },
      update: { name: seedBook.name, order: bookOrder, contentCollectionId: collectionId, key },
      create: { slug: seedBook.slug, name: seedBook.name, order: bookOrder, contentCollectionId: collectionId, key },
    });
    bookIds.push(book.id);
  }

  const existingChapters = await prisma.chapter.findMany({
    where: { bookId: { in: bookIds } },
    select: { id: true, bookId: true, number: true, order: true, heading: true, audioUrl: true, audioCheck: { select: { id: true } }, verses: { select: { id: true, number: true, text: true } } },
  });
  const chapterByKey = new Map(existingChapters.map((c) => [`${c.bookId}:${c.number}`, c]));

  const chapterCreates: Prisma.ChapterCreateManyInput[] = [];
  const chapterUpdates: { id: string; order: number; heading: string | null }[] = [];
  const verseCreates: Prisma.VerseCreateManyInput[] = [];
  const verseUpdates: { id: string; text: string }[] = [];
  const verseDeletes: string[] = [];
  const generatedByChapter = new Map<string, { exerciseRows: ExerciseRow[]; optionRows: OptionRow[] }>();
  const chapterIds: string[] = [];
  const audioChanges: AudioTextChange[] = [];
  const changeByChapter = new Map<string, ChapterChange>();

  books.forEach((seedBook, bookIndex) => {
    const bookId = bookIds[bookIndex];
    let bookExercises = 0;
    seedBook.chapters.forEach((seedChapter, chapterOrder) => {
      const heading = seedChapter.heading ?? null;
      const existing = chapterByKey.get(`${bookId}:${seedChapter.number}`);
      const chapterId = existing?.id ?? randomUUID();
      chapterIds.push(chapterId);
      const change: ChapterChange = {
        bookSlug: seedBook.slug, bookName: seedBook.name, chapter: seedChapter.number, isNew: !existing,
        verses: { created: 0, updated: 0, deleted: 0, changedNumbers: [] }, exercises: { kept: 0, created: 0, retired: 0, deleted: 0 }, audioAffected: false,
      };
      changeByChapter.set(chapterId, change);
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
          change.verses.created++;
          change.verses.changedNumbers.push(i + 1);
          return id;
        }
        if (current.text !== text) {
          verseUpdates.push({ id: current.id, text });
          change.verses.updated++;
          change.verses.changedNumbers.push(i + 1);
        }
        return current.id;
      });
      for (const verse of existing?.verses ?? []) {
        if (verse.number > seedChapter.verses.length) {
          verseDeletes.push(verse.id);
          change.verses.deleted++;
          change.verses.changedNumbers.push(verse.number);
        }
      }
      // Een hoofdstuk met voorgelezen audio waarvan de tekst verandert: de audio hoort dan niet meer vanzelf bij de tekst.
      if (existing && change.verses.changedNumbers.length > 0 && (existing.audioUrl || existing.audioCheck)) {
        change.audioAffected = true;
        audioChanges.push({
          chapterId,
          hasAudio: !!existing.audioUrl,
          before: [...existing.verses].sort((a, b) => a.number - b.number).map((v) => v.text),
          after: seedChapter.verses,
        });
      }

      const generated = chapterExercises(seedBook, seedChapter, chapterId, verseIds, language);
      generatedByChapter.set(chapterId, generated);
      bookExercises += generated.exerciseRows.length;
    });
    log(`  - ${seedBook.name}: ${seedBook.chapters.length} hoofdstukken, ${bookExercises} oefeningen`);
  });

  // De audiomarkering gebeurt vóór de verzen worden overschreven (de registratie bewaart de oude tekst als vastgestelde stand).
  let audio: AudioFlagStats = { flagged: audioChanges.length, alreadyFlagged: 0, restored: 0 };
  if (!dryRun) {
    audio = await flagAudioForTextChanges(prisma, audioChanges);
    await inChunks(chapterCreates, (data) => prisma.chapter.createMany({ data }));
    for (const c of chapterUpdates) {
      await prisma.chapter.update({ where: { id: c.id }, data: { order: c.order, heading: c.heading } });
    }
    await inChunks(verseCreates, (data) => prisma.verse.createMany({ data }));
    await inChunks(verseUpdates, (chunk) =>
      prisma.$transaction(chunk.map((v) => prisma.verse.update({ where: { id: v.id }, data: { text: v.text } })))
    );
  }
  log(`  Verzen: ${verseCreates.length} nieuw, ${verseUpdates.length} gewijzigd, ${verseDeletes.length} verwijderd${dryRun ? " (droogloop, niets geschreven)" : ""}.`);

  const exercises = await syncChapterExercises(prisma, generatedByChapter, dryRun);
  log(`  Oefeningen: ${exercises.kept} ongewijzigd behouden, ${exercises.updated} bijgewerkt, ${exercises.created} nieuw, ${exercises.retired} buiten gebruik gesteld, ${exercises.deleted} verwijderd (ongebruikt).`);
  if (audioChanges.length > 0) log(`  Audio: ${audioChanges.length} hoofdstuk(ken) met gewijzigde tekst ${dryRun ? "zouden ter controle worden aangemerkt" : "ter controle aangemerkt"}; de audio zelf blijft ongewijzigd beschikbaar.`);
  // Pas na de oefeningen: die verwijzen alleen nog naar bestaande verzen.
  if (!dryRun && verseDeletes.length > 0) await prisma.verse.deleteMany({ where: { id: { in: verseDeletes } } });

  // Een lopende reseed synchroniseert de cursussen één keer na alle collecties (zie runSeed); losse aanroepen doen het zelf.
  if (!dryRun && options.syncCourses !== false) await inPhase("Cursussen", () => syncCourses(prisma));

  const changes: ChapterChange[] = [];
  for (const [chapterId, change] of changeByChapter) {
    const perExercise = exercises.perChapter?.get(chapterId);
    if (perExercise) change.exercises = perExercise;
    if (change.isNew || change.verses.changedNumbers.length > 0 || change.exercises.created + change.exercises.retired + change.exercises.deleted > 0) changes.push(change);
  }
  return {
    chapters: { created: chapterCreates.length, updated: chapterUpdates.length },
    verses: { created: verseCreates.length, updated: verseUpdates.length, deleted: verseDeletes.length },
    exercises: { kept: exercises.kept, updated: exercises.updated, created: exercises.created, retired: exercises.retired, deleted: exercises.deleted },
    audio,
    changes,
    dryRun,
  };
}
