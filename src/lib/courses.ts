import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { capitalize, chapterTerm } from "./chapterTerm";
import { ensurePodcasts, PODCASTS, PODCASTS_COLLECTION_ID } from "./podcasts";
import { splitVerseRange } from "./learning/exercisePlan";

export const FRONT_TO_BACK_SLUG = "voor-naar-achter";
export const FREE_CHOICE_SLUG = "vrije-keuze";
export const PODCAST_SLUG = "podcast";
export const KIDS_SLUG = "kinderen";
export const INTRO_SLUG = "ontdek-boek-van-mormon";
export const READING_LESSONS_SLUG = "lezen-van-voor-naar-achter";
export const FSY_SLUG = "voor-de-kracht-van-de-jeugd";


// De stappen van Stap voor stap zijn de delen van het oefenplan (zie
// src/lib/learning/exercisePlan.ts): één indeling voor elke route.
export { splitVerseRange } from "./learning/exercisePlan";

export interface PlannedLesson {
  chapterId: string;
  startVerse: number;
  endVerse: number;
  order: number;
  exerciseIds: string[];
}

export interface LessonSyncResult {
  created: number;
  updated: number;
  reordered: number;
  removed: number;
  /** Voortgang/sessies van verdwenen lessen die naar een les in hetzelfde hoofdstuk zijn overgezet. */
  remapped: number;
}

/**
 * Past het lessenplan van een leescursus toe. Een les wordt geïdentificeerd door
 * (cursus, hoofdstuk, beginvers) en nooit door zijn volgorde: bestaande lessen
 * behouden hun id, en daarmee hun voortgang, sessies en "huidige les".
 *
 * De volgorde heeft een unieke constraint (courseId, order). Een les een andere
 * plek geven botst daarom tijdelijk met de les die daar nu nog staat (wisselen,
 * invoegen, verplaatsen, of lessen verdwijnen). Daarom, in één transactie:
 * 1. alle bestaande lessen van de cursus gaan naar een tijdelijke, unieke
 *    negatieve volgorde (een-op-een, dus zonder botsing met elkaar of met de
 *    definitieve volgorde, die nooit negatief is);
 * 2. elke geplande les krijgt zijn definitieve volgorde (of wordt aangemaakt);
 * 3. lessen die niet meer in het plan staan worden pas daarna opgeruimd, en hun
 *    voortgang, oefensessies en "huidige les" gaan eerst naar de les die dat
 *    beginvers nu dekt, zodat niets van een gebruiker meeverdwijnt.
 * Een fout laat de oude toestand volledig staan. Opnieuw draaien met hetzelfde
 * plan verandert niets (idempotent).
 */
export async function applyLessonPlan(tx: Prisma.TransactionClient, courseId: string, plan: PlannedLesson[]): Promise<LessonSyncResult> {
  const keyOf = (chapterId: string, startVerse: number) => `${chapterId}:${startVerse}`;
  const planned = new Map(plan.map((lesson) => [keyOf(lesson.chapterId, lesson.startVerse), lesson]));
  if (planned.size !== plan.length) throw new Error("Het lessenplan bevat dezelfde les twee keer (hoofdstuk en beginvers).");
  if (new Set(plan.map((lesson) => lesson.order)).size !== plan.length || plan.some((lesson) => lesson.order < 0)) throw new Error("Het lessenplan heeft een dubbele of negatieve volgorde.");

  const existing = await tx.courseLesson.findMany({ where: { courseId }, select: { id: true, chapterId: true, startVerse: true, endVerse: true, order: true } });
  const result: LessonSyncResult = { created: 0, updated: 0, reordered: 0, removed: 0, remapped: 0 };
  const existingByKey = new Map(existing.map((lesson) => [keyOf(lesson.chapterId, lesson.startVerse), lesson]));

  if (existing.length > 0) await tx.$executeRaw`UPDATE "CourseLesson" SET "order" = -"order" - 1 WHERE "courseId" = ${courseId} AND "order" >= 0`;

  const idByKey = new Map<string, string>();
  for (const lesson of plan) {
    const key = keyOf(lesson.chapterId, lesson.startVerse);
    const known = existingByKey.get(key);
    let id: string;
    if (known) {
      await tx.courseLesson.update({ where: { id: known.id }, data: { order: lesson.order, endVerse: lesson.endVerse } });
      id = known.id;
      if (known.order !== lesson.order) result.reordered++;
      else if (known.endVerse !== lesson.endVerse) result.updated++;
    } else {
      id = (await tx.courseLesson.create({ data: { courseId, chapterId: lesson.chapterId, startVerse: lesson.startVerse, endVerse: lesson.endVerse, order: lesson.order } })).id;
      result.created++;
    }
    idByKey.set(key, id);
    await tx.courseLessonExercise.deleteMany({ where: { lessonId: id } });
    if (lesson.exerciseIds.length > 0) {
      await tx.courseLessonExercise.createMany({ data: lesson.exerciseIds.map((exerciseId, index) => ({ lessonId: id, exerciseId, order: index })) });
    }
  }

  const stale = existing.filter((lesson) => !planned.has(keyOf(lesson.chapterId, lesson.startVerse)));
  for (const lesson of stale) {
    // De les in hetzelfde hoofdstuk die het beginvers van de verdwenen les nu dekt (anders de eerste van dat hoofdstuk).
    const candidates = plan.filter((p) => p.chapterId === lesson.chapterId).sort((x, y) => x.startVerse - y.startVerse);
    const target = [...candidates].reverse().find((p) => p.startVerse <= lesson.startVerse) ?? candidates[0];
    const targetId = target ? idByKey.get(keyOf(target.chapterId, target.startVerse)) : undefined;
    if (targetId) {
      const progress = await tx.userCourseLessonProgress.findMany({ where: { lessonId: lesson.id }, select: { id: true, userId: true } });
      const taken = new Set((await tx.userCourseLessonProgress.findMany({ where: { lessonId: targetId, userId: { in: progress.map((row) => row.userId) } }, select: { userId: true } })).map((row) => row.userId));
      for (const row of progress) {
        if (taken.has(row.userId)) continue;
        await tx.userCourseLessonProgress.update({ where: { id: row.id }, data: { lessonId: targetId } });
        result.remapped++;
      }
      result.remapped += (await tx.exerciseSession.updateMany({ where: { courseLessonId: lesson.id }, data: { courseLessonId: targetId } })).count;
      await tx.userCourseProgress.updateMany({ where: { currentLessonId: lesson.id }, data: { currentLessonId: targetId } });
    }
  }
  if (stale.length > 0) {
    await tx.courseLesson.deleteMany({ where: { id: { in: stale.map((lesson) => lesson.id) } } });
    result.removed = stale.length;
  }
  return result;
}

async function syncReadingLessons(
  db: PrismaClient,
  courseId: string,
  books: { chapters: { id: string; number: number; order: number; bookId: string }[] }[]
): Promise<void> {
  const chapters = books.flatMap((book) => book.chapters);
  const chapterIds = chapters.map((chapter) => chapter.id);
  const exercises = chapterIds.length === 0
    ? []
    : await db.exercise.findMany({
        where: { chapterId: { in: chapterIds }, status: "APPROVED" },
        orderBy: { order: "asc" },
        select: { id: true, chapterId: true, sourceVerse: { select: { number: true } } },
      });

  const exercisesByChapter = new Map<string, { id: string; verseNumber: number | null }[]>();
  for (const exercise of exercises) {
    const list = exercisesByChapter.get(exercise.chapterId) ?? [];
    list.push({ id: exercise.id, verseNumber: exercise.sourceVerse?.number ?? null });
    exercisesByChapter.set(exercise.chapterId, list);
  }

  const verseCounts = chapterIds.length === 0 ? [] : await db.verse.groupBy({ by: ["chapterId"], where: { chapterId: { in: chapterIds } }, _count: { _all: true } });
  const countByChapter = new Map(verseCounts.map((row) => [row.chapterId, row._count._all]));

  const plan: PlannedLesson[] = [];
  for (const chapter of chapters) {
    const chapterExercises = exercisesByChapter.get(chapter.id) ?? [];
    for (const range of splitVerseRange(countByChapter.get(chapter.id) ?? 0)) {
      plan.push({
        chapterId: chapter.id,
        startVerse: range.startVerse,
        endVerse: range.endVerse,
        order: plan.length,
        exerciseIds: chapterExercises
          .filter((exercise) => exercise.verseNumber !== null && exercise.verseNumber >= range.startVerse && exercise.verseNumber <= range.endVerse)
          .map((exercise) => exercise.id),
      });
    }
  }

  await db.$transaction((tx) => applyLessonPlan(tx, courseId, plan), { maxWait: 30_000, timeout: 10 * 60_000 });
}

// Collectienamen zoals ze midden in een zin staan ("Lees de Leer en
// Verbonden"). Letterlijke id's: contentCollections.ts trekt de
// databaseclient van Next mee, en dit bestand draait ook los via tsx.
const NAME_IN_SENTENCE: Record<string, string> = {
  content_dc: "de Leer en Verbonden",
  content_pgp: "de Parel van Grote Waarde",
};

interface ScriptureCollection {
  id: string;
  slug: string;
  name: string;
}

type SyncBook = { slug: string; chapters: { id: string; number: number; order: number; bookId: string }[] };

/**
 * De cursussen die bij een schriftcollectie horen: vrije keuze, van voor naar
 * achter en de leeslessen, over alle boeken van die collectie in volgorde.
 * Het Boek van Mormon houdt zijn oorspronkelijke slugs (abonnementen en
 * voortgang hangen aan die cursussen); andere collecties krijgen de slug met
 * hun collectienaam erachter. `enabled` wordt bewust niet aangeraakt: dat zet
 * een beheerder zelf aan of uit.
 */
async function syncScriptureCourses(
  db: PrismaClient,
  collection: ScriptureCollection,
  books: SyncBook[],
  isDefault: boolean,
  texts: { freeChoice: string; frontToBack: string; frontToBackName: string; readingLessons: string }
): Promise<void> {
  const slugFor = (base: string) => (isDefault ? base : `${base}-${collection.slug}`);
  const chapters = books.flatMap((book) => book.chapters);

  async function upsertCourse(base: string, type: "FREE_CHOICE" | "FRONT_TO_BACK" | "READING_LESSONS", name: string, description: string, order: number) {
    const slug = slugFor(base);
    return db.course.upsert({
      where: { slug },
      update: { name, description, order, contentCollectionId: collection.id },
      create: { slug, type, name, description, order, contentCollectionId: collection.id },
    });
  }

  async function setChapters(courseId: string) {
    await db.courseChapter.deleteMany({ where: { courseId } });
    const rows = chapters.map((chapter, order) => ({ courseId, chapterId: chapter.id, order }));
    if (rows.length > 0) await db.courseChapter.createMany({ data: rows });
  }

  // Zelfde volledige hoofdstuklijst als "van voor naar achter" (alleen de
  // volgorde van het join-record — ChapterListCourseView vergrendelt bij
  // FREE_CHOICE toch niets, zie sequential daar), zodat deze cursus zijn
  // eigen pagina heeft i.p.v. terug te vallen op de generieke dashboard-
  // weergave.
  const freeChoice = await upsertCourse(FREE_CHOICE_SLUG, "FREE_CHOICE", "Vrije keuze", texts.freeChoice, 0);
  await setChapters(freeChoice.id);

  const frontToBack = await upsertCourse(FRONT_TO_BACK_SLUG, "FRONT_TO_BACK", texts.frontToBackName, texts.frontToBack, 1);
  await setChapters(frontToBack.id);

  const readingLessons = await upsertCourse(READING_LESSONS_SLUG, "READING_LESSONS", "Stap voor stap", texts.readingLessons, 2);
  await syncReadingLessons(db, readingLessons.id, books);
}

/**
 * Bouwt de structurele cursussen opnieuw op vanuit de huidige boeken/
 * hoofdstukken: per schriftcollectie vrije keuze, van voor naar achter en de
 * leeslessen (zie syncScriptureCourses), plus de introductie- en kindercursus
 * bij het Boek van Mormon. Bewust idempotent: opnieuw draaien na een
 * content-import zet alles weer in sync. Gebruikersvoortgang
 * (UserCourseProgress) blijft intact, want Chapter-ID's blijven stabiel over
 * een re-import heen — alleen de CourseChapter-koppelrijen worden hier
 * weggegooid en herbouwd. Cursussen per boek bestaan niet meer (migratie
 * 20260924210000_remove_by_book_courses).
 */
export async function syncCourses(db: PrismaClient): Promise<void> {
  const defaultCollection = await db.contentCollection.findFirst({
    where: { enabled: true },
    orderBy: { order: "asc" },
    select: { id: true, slug: true, name: true },
  });
  if (!defaultCollection) throw new Error("Geen contentcollectie beschikbaar.");

  const books = await db.book.findMany({
    where: { contentCollectionId: defaultCollection.id },
    orderBy: { order: "asc" },
    include: { chapters: { orderBy: { order: "asc" } } },
  });

  // Negatieve order (i.p.v. de andere cursussen te moeten opschuiven) zodat
  // deze cursus standaard bovenaan staat — passend bij "voor wie nog geen
  // voorkennis heeft". Singleton, net als PODCAST/KIDS: geen CourseChapter-
  // rijen, alle IntroLesson-rijen (zie prisma/importIntro.ts) horen er
  // impliciet allemaal bij.
  await db.course.upsert({
    where: { slug: INTRO_SLUG },
    update: { name: "Ontdek het Boek van Mormon", order: -1, contentCollectionId: defaultCollection.id },
    create: {
      slug: INTRO_SLUG,
      type: "INTRO",
      name: "Ontdek het Boek van Mormon",
      description: "Een korte introductiecursus voor wie nog nooit het Boek van Mormon heeft gelezen.",
      order: -1,
      contentCollectionId: defaultCollection.id,
    },
  });

  await syncScriptureCourses(db, defaultCollection, books, true, {
    freeChoice: "Kies zelf welk hoofdstuk je wil doen, in elke volgorde.",
    frontToBack: "Eén vaste volgorde door alle boeken heen, hoofdstuk na hoofdstuk.",
    frontToBackName: "Hoofdstuk voor hoofdstuk",
    readingLessons: "Lees het hele Boek van Mormon in korte stappen van ongeveer 5 tot 10 verzen.",
  });

  // De andere schriftcollecties (Leer en Verbonden, Parel van Grote Waarde):
  // dezelfde soorten cursussen, elk over de eigen boeken.
  const otherBooks = await db.book.findMany({
    where: { contentCollectionId: { not: defaultCollection.id } },
    orderBy: { order: "asc" },
    include: { chapters: { orderBy: { order: "asc" } }, contentCollection: { select: { id: true, slug: true, name: true } } },
  });
  const byCollection = new Map<string, { collection: ScriptureCollection; books: typeof otherBooks }>();
  for (const book of otherBooks) {
    const entry = byCollection.get(book.contentCollectionId) ?? { collection: book.contentCollection, books: [] };
    entry.books.push(book);
    byCollection.set(book.contentCollectionId, entry);
  }
  for (const { collection, books: collectionBooks } of byCollection.values()) {
    const term = chapterTerm(collectionBooks[0]?.slug, collection.id);
    const across = collectionBooks.length > 1 ? " door alle boeken heen," : ",";
    await syncScriptureCourses(db, collection, collectionBooks, false, {
      freeChoice: `Kies zelf welk${term.singular === "afdeling" ? "e" : ""} ${term.singular} je wil doen, in elke volgorde.`,
      frontToBack: `Eén vaste volgorde${across} ${term.singular} na ${term.singular}.`,
      // "Afdeling voor afdeling" bij de Leer en Verbonden.
      frontToBackName: `${capitalize(term.singular)} voor ${term.singular}`,
      readingLessons: `Lees ${NAME_IN_SENTENCE[collection.id] ?? collection.name} helemaal door, in korte stappen van ongeveer 5 tot 10 verzen.`,
    });
  }

  // Per podcast één cursus, zonder CourseChapter-rijen: de PodcastEpisode-
  // rijen van die podcast (zie prisma/importPodcast.ts en
  // src/lib/podcastFeed.ts) horen er impliciet allemaal bij.
  await ensurePodcasts(db);
  // Zonder de migratie van de Podcasts-collectie (oudere installatie) blijven
  // de podcastcursussen bij de standaardcollectie, zoals voorheen.
  const podcastsCollection = await db.contentCollection.findUnique({
    where: { id: PODCASTS_COLLECTION_ID },
    select: { id: true },
  });
  const podcastsCollectionId = podcastsCollection?.id ?? defaultCollection.id;
  for (const podcast of PODCASTS) {
    await db.course.upsert({
      where: { slug: podcast.courseSlug },
      update: {
        name: podcast.courseName,
        order: podcast.courseOrderOffset + books.length,
        contentCollectionId: podcastsCollectionId,
        podcastId: podcast.id,
      },
      create: {
        slug: podcast.courseSlug,
        type: "PODCAST",
        name: podcast.courseName,
        description: podcast.courseDescription,
        order: podcast.courseOrderOffset + books.length,
        contentCollectionId: podcastsCollectionId,
        podcastId: podcast.id,
      },
    });
  }

  // Singleton, net als PODCAST: geen CourseChapter-rijen, alle KidsStory-
  // rijen (zie prisma/importKids.ts) horen er impliciet allemaal bij.
  await db.course.upsert({
    where: { slug: KIDS_SLUG },
    update: { name: "Verhalen uit het Boek van Mormon (voor kinderen)", order: 4 + books.length, contentCollectionId: defaultCollection.id },
    create: {
      slug: KIDS_SLUG,
      type: "KIDS",
      name: "Verhalen uit het Boek van Mormon (voor kinderen)",
      description: "Korte, geïllustreerde verhalen met een plaatjesspel en simpele vraagjes — leuk voor de kleintjes.",
      order: 3 + books.length,
      contentCollectionId: defaultCollection.id,
    },
  });

  // FSY heeft een eigen contentfamilie en geen CourseChapter-rijen. De
  // cursus wordt alleen aangemaakt als de collectie aanwezig is, zodat een
  // oudere installatie zonder FSY-migratie gewoon blijft werken.
  const fsyCollection = await db.contentCollection.findUnique({
    where: { id: "content_fsy" },
    select: { id: true },
  });
  if (fsyCollection) {
    await db.course.upsert({
      where: { slug: FSY_SLUG },
      update: {
        name: "Voor de kracht van de jeugd",
        description: "Het wekelijkse leerplan met tekst en afbeeldingen uit de officiële bron.",
        order: 0,
        contentCollectionId: fsyCollection.id,
      },
      create: {
        slug: FSY_SLUG,
        type: "FSY",
        name: "Voor de kracht van de jeugd",
        description: "Het wekelijkse leerplan met tekst en afbeeldingen uit de officiële bron.",
        order: 0,
        contentCollectionId: fsyCollection.id,
      },
    });
  }
}

/**
 * Bepaalt en registreert het volgende hoofdstuk in een cursus voor een
 * gebruiker, na het afronden van `completedChapterId` (of bij een eerste
 * bezoek als die nog niet is opgegeven). Voor FREE_CHOICE wordt nooit een
 * "volgende" hoofdstuk vastgelegd — dat blijft altijd de eigen keuze.
 */
export async function advanceCourseProgress(
  db: PrismaClient,
  userId: string,
  courseId: string,
  completedChapterId?: string
): Promise<void> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: { chapters: { orderBy: { order: "asc" }, select: { chapterId: true } } },
  });
  if (!course || course.type === "FREE_CHOICE") return;

  if (course.type === "READING_LESSONS") {
    const lessons = await db.courseLesson.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    let nextLessonId: string | null;
    if (completedChapterId) {
      const completedLesson = await db.courseLesson.findFirst({
        where: { courseId, chapterId: completedChapterId },
        orderBy: { order: "asc" },
        select: { order: true },
      });
      if (!completedLesson) return;
      const next = lessons[completedLesson.order + 1];
      nextLessonId = next?.id ?? null;
    } else {
      nextLessonId = lessons[0]?.id ?? null;
    }
    await db.userCourseProgress.upsert({
      where: { userId_courseId: { userId, courseId } },
      update: { currentLessonId: nextLessonId, currentChapterId: null, lastActivityAt: new Date() },
      create: { userId, courseId, currentLessonId: nextLessonId },
    });
    return;
  }

  const orderedChapterIds = course.chapters.map((c) => c.chapterId);
  let nextChapterId: string | null;
  if (completedChapterId) {
    const idx = orderedChapterIds.indexOf(completedChapterId);
    if (idx === -1) return; // dit hoofdstuk hoort niet bij deze cursus, niks aanpassen
    nextChapterId = orderedChapterIds[idx + 1] ?? null;
  } else {
    nextChapterId = orderedChapterIds[0] ?? null;
  }

  await db.userCourseProgress.upsert({
    where: { userId_courseId: { userId, courseId } },
    update: { currentChapterId: nextChapterId, lastActivityAt: new Date() },
    create: { userId, courseId, currentChapterId: nextChapterId },
  });
}

/**
 * Voegt een cursus toe aan de persoonlijke cursussenlijst van een gebruiker
 * ("Cursussen"), of herstelt 'm na eerder verwijderen. UserCourseProgress
 * (dus ook currentChapterId, de voortgang) blijft altijd bestaan zodra die
 * ooit is aangemaakt — dit zet alleen `subscribed` aan, nooit uit (zie de
 * unsubscribe-route voor het tegenovergestelde). Bij een cursus die deze
 * gebruiker nog nooit koos, wordt voor niet-FREE_CHOICE-types meteen een
 * eerste hoofdstuk klaargezet (via advanceCourseProgress); FREE_CHOICE
 * heeft daar geen "volgende hoofdstuk"-concept voor, dus krijgt gewoon een
 * kale rij.
 */
export async function subscribeUserToCourse(db: PrismaClient, userId: string, courseId: string): Promise<void> {
  const existing = await db.userCourseProgress.findUnique({ where: { userId_courseId: { userId, courseId } } });
  if (existing) {
    if (!existing.subscribed) {
      await db.userCourseProgress.update({ where: { userId_courseId: { userId, courseId } }, data: { subscribed: true } });
    }
    return;
  }

  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) return;
  if (course.type === "FREE_CHOICE") {
    await db.userCourseProgress.create({ data: { userId, courseId } });
  } else {
    await advanceCourseProgress(db, userId, courseId);
  }
}

/**
 * Maakt een cursus de actieve ("Jouw huidige leerreis") zodra je er
 * daadwerkelijk mee bezig gaat: bij het openen van een les of stap eruit.
 * Alleen een cursus uit je eigen overzicht (subscribed); een cursus bekijken
 * of toevoegen maakt hem niet actief, en een les via een losse link (zoeken,
 * bladwijzer) zonder cursus verandert niets.
 */
export async function markCourseStarted(db: PrismaClient, userId: string, courseId: string): Promise<void> {
  const progress = await db.userCourseProgress.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { subscribed: true },
  });
  if (!progress?.subscribed) return;
  // OR met null: "activeCourseId <> x" is in SQL onwaar voor een lege waarde.
  await db.user.updateMany({
    where: { id: userId, OR: [{ activeCourseId: null }, { activeCourseId: { not: courseId } }] },
    data: { activeCourseId: courseId },
  });
}
