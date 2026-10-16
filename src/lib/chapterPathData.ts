import type { PrismaClient } from "@/generated/prisma/client";
import { advanceCourseProgress } from "@/lib/courses";
import { getChapterStates } from "@/lib/learning/contentProgress";
import { countWords, estimateReadingMinutes } from "@/lib/learning/readingTime";
import { getStepOverview } from "@/lib/readingLessons";
import { chapterLocks, defaultOpenBookKey, groupByBook, todayChapterId, type ChapterItem } from "@/lib/readingCourses";

export interface ChapterPathData {
  chapters: ChapterItem[];
  /** Hoofdstuk Voor hoofdstuk: het hoofdstuk dat nu aan de beurt is; Vrije keuze: altijd null (geen volgende). */
  todayId: string | null;
  /** Geschatte leestijd en nog te verdienen XP, alleen voor het hoofdstuk dat aan de beurt is. */
  todayMinutes: number;
  todayXp: number;
  /** Het boek dat standaard openstaat; null = alles ingeklapt. */
  defaultOpenBook: string | null;
}

/**
 * De gegevens van Hoofdstuk voor hoofdstuk (FRONT_TO_BACK) en Vrije keuze (FREE_CHOICE): elk hoofdstuk met zijn gedeelde
 * lees- en oefenvoortgang. Eén keer per aanvraag: geen query per hoofdstuk en geen verstekst van de hele cursus.
 *
 * Alleen lezen voor Vrije keuze: de positie in Stap voor stap wordt hier met getStepOverview bepaald zonder die cursus te
 * synchroniseren, te starten of de voortgangscursor weg te schrijven (dat doet alleen het leerpad van Stap voor stap zelf).
 */
export async function loadChapterPath(db: PrismaClient, userId: string, course: { id: string; type: string; contentCollectionId: string }): Promise<ChapterPathData> {
  const sequential = course.type !== "FREE_CHOICE";
  const rows = await db.courseChapter.findMany({
    where: { courseId: course.id },
    orderBy: { order: "asc" },
    select: { chapter: { select: { id: true, number: true, book: { select: { name: true, key: true } }, _count: { select: { verses: true } } } } },
  });
  const raw = rows.map((row) => row.chapter);
  const states = await getChapterStates(db, userId, raw);
  const chapters: ChapterItem[] = raw.map((chapter) => {
    const state = states.get(chapter.id)!;
    return {
      id: chapter.id,
      number: chapter.number,
      bookKey: chapter.book.key,
      bookName: chapter.book.name,
      verseCount: chapter._count.verses,
      read: state.read,
      exercisesAnswered: state.exercisesAnswered,
      exercisesTotal: state.exercisesTotal,
      exerciseScore: state.exerciseScore,
      completed: state.done,
    };
  });
  const groups = groupByBook(chapters);

  if (!sequential) {
    // Vrije keuze: alle hoofdstukken zijn vrij. Alleen het standaard geopende boek volgt de voortgang, uit bestaande gegevens.
    const sibling = await db.course.findFirst({
      where: { contentCollectionId: course.contentCollectionId, type: "READING_LESSONS" },
      select: { id: true },
    });
    // Alleen een echte positie telt: wie nog niets gedaan heeft staat op de allereerste stap en krijgt geen voorgeopend boek.
    const next = sibling && (await db.courseLesson.count({ where: { courseId: sibling.id } })) > 0 ? (await getStepOverview(db, userId, sibling.id)).next : null;
    const stepChapterId = next && next.order > 0 ? next.chapterId : null;
    const recent = await db.contentProgress.findFirst({
      where: { userId, lastChapterId: { in: chapters.map((chapter) => chapter.id) } },
      orderBy: { updatedAt: "desc" },
      select: { lastChapterId: true },
    });
    return { chapters, todayId: null, todayMinutes: 0, todayXp: 0, defaultOpenBook: defaultOpenBookKey(groups, [stepChapterId, recent?.lastChapterId]) };
  }

  // Hoofdstuk voor hoofdstuk: de bestaande voortgangscursor (zoals voorheen aangemaakt bij het eerste bezoek).
  let progress = await db.userCourseProgress.findUnique({ where: { userId_courseId: { userId, courseId: course.id } }, select: { currentChapterId: true } });
  if (!progress) {
    await advanceCourseProgress(db, userId, course.id);
    progress = await db.userCourseProgress.findUnique({ where: { userId_courseId: { userId, courseId: course.id } }, select: { currentChapterId: true } });
  }
  const todayId = todayChapterId(chapters, progress?.currentChapterId ?? null, chapterLocks(chapters, true));
  let todayMinutes = 0;
  let todayXp = 0;
  if (todayId) {
    const verses = await db.verse.findMany({ where: { chapterId: todayId }, select: { text: true } });
    todayMinutes = estimateReadingMinutes(verses.reduce((sum, verse) => sum + countWords(verse.text), 0));
    todayXp = states.get(todayId)?.xpAvailable ?? 0;
  }
  return { chapters, todayId, todayMinutes, todayXp, defaultOpenBook: defaultOpenBookKey(groups, [todayId]) };
}
