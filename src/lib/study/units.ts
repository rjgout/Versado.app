import type { CourseType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { shuffleForDisplay } from "@/lib/exerciseGen";
import type { TFunction } from "@/lib/i18n/core";

// Samen studeren werkt op elke cursus, dus hier staat per cursustype wat een
// "stap" is en welke vragen erbij horen: een hoofdstuk, een leesles, een
// introles, een kinderverhaal of één van de twee oefenrondes van een
// podcastaflevering. De rest van Samen studeren (src/server/study.ts, het
// scherm) kent alleen de sleutel van een stap en een lijst vragen in de vorm
// van de bestaande oefenkaart. FSY-lessen hebben geen vragen en doen dus niet
// mee. Geen server-only imports buiten prisma: dit draait ook in de
// socketserver (zie de eager-keten in CLAUDE.md).

// Net als een gewone hoofdstukles (lesson/[chapterId]/page.tsx): een hoofdstuk
// kan tientallen oefeningen hebben, een stap krijgt er een vaste greep uit.
const MAX_CHAPTER_QUESTIONS = 7;
// En een leesles krijgt er, net als op reading-lesson/[lessonId]/page.tsx, drie.
const MAX_READING_QUESTIONS = 3;

export const STUDY_COURSE_TYPES: readonly CourseType[] = ["FRONT_TO_BACK", "READING_LESSONS", "FREE_CHOICE", "BY_BOOK", "INTRO", "KIDS", "PODCAST"];

export function supportsStudy(type: CourseType): boolean {
  return STUDY_COURSE_TYPES.includes(type);
}

export interface StudyUnit {
  key: string;
  label: string;
}

export interface StudyUnitGroup {
  label: string;
  units: StudyUnit[];
}

/**
 * De inhoud die de groep vóór de vragen samen ziet. Deze vorm bevat nooit
 * antwoorden en is dus veilig om via de socket naar ieder groepslid te sturen.
 */
export type StudyUnitContent =
  | {
      kind: "scripture";
      chapterId: string;
      bookName: string;
      chapterNumber: number;
      language: string;
      verses: { id: string; number: number; text: string; audioStart: number | null }[];
    }
  | { kind: "intro"; number: number; title: string; content: string }
  | { kind: "kids"; number: number; title: string; text: string; images: string[] }
  | { kind: "podcast"; episodeId: string; number: number; title: string; summary: string | null; audioUrl: string | null; chapters: string | null };

/** Een vraag zoals iedereen in de ronde hem krijgt; `answers` blijft op de server. */
export interface StudyQuestion {
  source: "exercise" | "intro" | "kids" | "podcast";
  id: string;
  type: "FILL_BLANK" | "WORD_BANK" | "TRUE_FALSE" | "MULTIPLE_CHOICE" | "SEQUENCE" | "IMAGE_CHOICE";
  verseRef: string;
  prompt: string;
  answers: string[];
  wordBank?: string[];
  options?: string[];
}

export type PublicStudyQuestion = Omit<StudyQuestion, "answers" | "source"> & { blanks: number };

export function publicQuestion(q: StudyQuestion): PublicStudyQuestion {
  return { id: q.id, type: q.type, verseRef: q.verseRef, prompt: q.prompt, blanks: q.answers.length, wordBank: q.wordBank, options: q.options };
}

type CourseRef = { id: string; type: CourseType; podcastId: string | null };

function podcastModeLabel(mode: string, t: TFunction): string {
  return mode === "BOM_CONNECTION" ? t("study.podcastBom") : t("study.podcastContent");
}

/** Alle stappen van een cursus, gegroepeerd (per boek, of één groep), in cursusvolgorde. */
export async function studyUnitsForCourse(course: CourseRef, t: TFunction): Promise<StudyUnitGroup[]> {
  const groups: StudyUnitGroup[] = [];
  const push = (groupLabel: string, unit: StudyUnit) => {
    const last = groups[groups.length - 1];
    if (last && last.label === groupLabel) last.units.push(unit);
    else groups.push({ label: groupLabel, units: [unit] });
  };

  switch (course.type) {
    case "FRONT_TO_BACK":
    case "FREE_CHOICE":
    case "BY_BOOK": {
      const rows = await prisma.courseChapter.findMany({
        where: { courseId: course.id, chapter: { exercises: { some: { status: "APPROVED" } } } },
        orderBy: { order: "asc" },
        select: { chapter: { select: { id: true, number: true, book: { select: { name: true } } } } },
      });
      for (const { chapter } of rows) push(chapter.book.name, { key: `ch:${chapter.id}`, label: `${chapter.book.name} ${chapter.number}` });
      break;
    }
    case "READING_LESSONS": {
      const rows = await prisma.courseLesson.findMany({
        where: { courseId: course.id, exercises: { some: {} } },
        orderBy: { order: "asc" },
        select: { id: true, startVerse: true, endVerse: true, chapter: { select: { number: true, book: { select: { name: true } } } } },
      });
      for (const lesson of rows) {
        const verses = lesson.startVerse === lesson.endVerse ? `${lesson.startVerse}` : `${lesson.startVerse}-${lesson.endVerse}`;
        push(lesson.chapter.book.name, { key: `rl:${lesson.id}`, label: `${lesson.chapter.book.name} ${lesson.chapter.number}:${verses}` });
      }
      break;
    }
    case "INTRO": {
      const rows = await prisma.introLesson.findMany({ where: { exercises: { some: {} } }, orderBy: { order: "asc" }, select: { id: true, number: true, title: true } });
      for (const lesson of rows) push("", { key: `in:${lesson.id}`, label: `${t("lessonFlows.lessonNumber", { n: lesson.number })} · ${lesson.title}` });
      break;
    }
    case "KIDS": {
      const rows = await prisma.kidsStory.findMany({
        where: { courseId: course.id, exercises: { some: {} } },
        orderBy: { order: "asc" },
        select: { id: true, number: true, title: true },
      });
      for (const story of rows) push("", { key: `kd:${story.id}`, label: `${t("misc.storyN", { n: story.number })} · ${story.title}` });
      break;
    }
    case "PODCAST": {
      if (!course.podcastId) break;
      const rows = await prisma.podcastEpisode.findMany({
        where: { podcastId: course.podcastId, exercises: { some: {} } },
        orderBy: { number: "desc" },
        select: { id: true, number: true, title: true, exercises: { select: { mode: true }, distinct: ["mode"] } },
      });
      for (const episode of rows) {
        const episodeLabel = t("courseViews.podcast.episode", { n: episode.number });
        for (const mode of ["CONTENT", "BOM_CONNECTION"]) {
          if (!episode.exercises.some((e) => e.mode === mode)) continue;
          push(episodeLabel, { key: `pc:${episode.id}:${mode}`, label: `${episodeLabel} · ${podcastModeLabel(mode, t)}` });
        }
      }
      break;
    }
    default:
      break;
  }
  return groups;
}

/**
 * De vragen van één stap, of null als die stap niet (meer) bij deze cursus
 * hoort. De sleutel komt van de host en wordt dus hier gecontroleerd, nooit
 * blind vertrouwd. Opties en woordenbanken worden één keer geschud: iedereen
 * in de ronde krijgt dezelfde volgorde.
 */
export async function loadStudyQuestions(course: CourseRef, unitKey: string, t: TFunction): Promise<{ label: string; questions: StudyQuestion[] } | null> {
  const [kind, id, mode] = unitKey.split(":");
  if (!id) return null;

  if (kind === "ch" && ["FRONT_TO_BACK", "FREE_CHOICE", "BY_BOOK"].includes(course.type)) {
    const link = await prisma.courseChapter.findFirst({
      where: { courseId: course.id, chapterId: id },
      select: {
        chapter: {
          select: {
            number: true,
            book: { select: { name: true } },
            exercises: { where: { status: "APPROVED" }, orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } },
          },
        },
      },
    });
    if (!link) return null;
    const picked = shuffleForDisplay(link.chapter.exercises).slice(0, MAX_CHAPTER_QUESTIONS);
    return {
      label: `${link.chapter.book.name} ${link.chapter.number}`,
      questions: picked.map((e) => ({
        source: "exercise",
        id: e.id,
        type: e.type,
        verseRef: e.verseRef,
        prompt: e.prompt,
        answers: JSON.parse(e.answers) as string[],
        // Zelfde als een gewone hoofdstukles: deze oefeningen zijn al bij het
        // genereren geschud.
        wordBank: e.wordBank ? (JSON.parse(e.wordBank) as string[]) : undefined,
        options: e.options.length > 0 ? e.options.map((o) => o.label) : undefined,
      })),
    };
  }

  if (kind === "rl" && course.type === "READING_LESSONS") {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id, courseId: course.id },
      select: {
        startVerse: true,
        endVerse: true,
        chapter: { select: { number: true, book: { select: { name: true } } } },
        exercises: { orderBy: { order: "asc" }, select: { exercise: { include: { options: { orderBy: { order: "asc" } } } } } },
      },
    });
    if (!lesson) return null;
    const verses = lesson.startVerse === lesson.endVerse ? `${lesson.startVerse}` : `${lesson.startVerse}-${lesson.endVerse}`;
    return {
      label: `${lesson.chapter.book.name} ${lesson.chapter.number}:${verses}`,
      questions: shuffleForDisplay(lesson.exercises).slice(0, MAX_READING_QUESTIONS).map(({ exercise: e }) => ({
        source: "exercise",
        id: e.id,
        type: e.type,
        verseRef: e.verseRef,
        prompt: e.prompt,
        answers: JSON.parse(e.answers) as string[],
        wordBank: e.wordBank ? (JSON.parse(e.wordBank) as string[]) : undefined,
        options: e.options.length > 0 ? e.options.map((o) => o.label) : undefined,
      })),
    };
  }

  if (kind === "in" && course.type === "INTRO") {
    const lesson = await prisma.introLesson.findUnique({
      where: { id },
      select: { number: true, title: true, exercises: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } },
    });
    if (!lesson) return null;
    const ref = t("lessonFlows.lessonNumber", { n: lesson.number });
    return {
      label: `${ref} · ${lesson.title}`,
      questions: lesson.exercises.map((e) => ({
        source: "intro",
        id: e.id,
        type: e.type,
        verseRef: ref,
        prompt: e.prompt,
        answers: JSON.parse(e.answers) as string[],
        wordBank: e.wordBank ? shuffleForDisplay(JSON.parse(e.wordBank) as string[]) : undefined,
        options: e.options.length > 0 ? shuffleForDisplay(e.options.map((o) => o.label)) : undefined,
      })),
    };
  }

  if (kind === "kd" && course.type === "KIDS") {
    const story = await prisma.kidsStory.findFirst({
      where: { id, courseId: course.id },
      select: { number: true, title: true, exercises: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } },
    });
    if (!story) return null;
    const ref = t("misc.storyN", { n: story.number });
    return {
      label: `${ref} · ${story.title}`,
      questions: story.exercises.map((e) => ({
        source: "kids",
        id: e.id,
        type: e.type,
        verseRef: ref,
        prompt: e.prompt,
        answers: JSON.parse(e.answers) as string[],
        wordBank: e.wordBank ? shuffleForDisplay(JSON.parse(e.wordBank) as string[]) : undefined,
        // Plaatjeskeuze: de optie is dan de afbeelding (zoals kids/[storyId]/page.tsx).
        options: e.options.length > 0 ? shuffleForDisplay(e.options.map((o) => o.imageUrl ?? o.label)) : undefined,
      })),
    };
  }

  if (kind === "pc" && course.type === "PODCAST" && (mode === "CONTENT" || mode === "BOM_CONNECTION")) {
    const episode = await prisma.podcastEpisode.findFirst({
      where: { id, podcastId: course.podcastId ?? undefined },
      select: { number: true, exercises: { where: { mode }, orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } } },
    });
    if (!episode || !course.podcastId) return null;
    const ref = t("courseViews.podcast.episode", { n: episode.number });
    return {
      label: `${ref} · ${podcastModeLabel(mode, t)}`,
      questions: episode.exercises.map((e) => ({
        source: "podcast",
        id: e.id,
        type: e.type,
        verseRef: ref,
        prompt: e.prompt,
        answers: JSON.parse(e.answers) as string[],
        wordBank: e.wordBank ? shuffleForDisplay(JSON.parse(e.wordBank) as string[]) : undefined,
        options: e.options.length > 0 ? shuffleForDisplay(e.options.map((o) => o.label)) : undefined,
      })),
    };
  }

  return null;
}

/**
 * Haalt precies de inhoud op die bij een geldige studiestap hoort. Dit is
 * bewust los van de vragen: de groep kan de inhoud al zien zonder dat de
 * client ooit de antwoorden van de ronde ontvangt.
 */
export async function loadStudyContent(course: CourseRef, unitKey: string): Promise<StudyUnitContent | null> {
  const [kind, id] = unitKey.split(":");
  if (!id) return null;

  if (kind === "ch" && ["FRONT_TO_BACK", "FREE_CHOICE", "BY_BOOK"].includes(course.type)) {
    const link = await prisma.courseChapter.findFirst({
      where: { courseId: course.id, chapterId: id },
      select: {
        chapter: {
          select: {
            id: true,
            number: true,
            book: { select: { name: true, contentCollection: { select: { language: true } } } },
            verses: { orderBy: { number: "asc" }, select: { id: true, number: true, text: true, audioStart: true } },
          },
        },
      },
    });
    if (!link) return null;
    return {
      kind: "scripture",
      chapterId: link.chapter.id,
      bookName: link.chapter.book.name,
      chapterNumber: link.chapter.number,
      language: link.chapter.book.contentCollection.language,
      verses: link.chapter.verses,
    };
  }

  if (kind === "rl" && course.type === "READING_LESSONS") {
    const lesson = await prisma.courseLesson.findFirst({
      where: { id, courseId: course.id },
      select: {
        chapter: {
          select: {
            id: true,
            number: true,
            book: { select: { name: true, contentCollection: { select: { language: true } } } },
            verses: { orderBy: { number: "asc" }, select: { id: true, number: true, text: true, audioStart: true } },
          },
        },
        startVerse: true,
        endVerse: true,
      },
    });
    if (!lesson) return null;
    return {
      kind: "scripture",
      chapterId: lesson.chapter.id,
      bookName: lesson.chapter.book.name,
      chapterNumber: lesson.chapter.number,
      language: lesson.chapter.book.contentCollection.language,
      verses: lesson.chapter.verses.filter((verse) => verse.number >= lesson.startVerse && verse.number <= lesson.endVerse),
    };
  }

  if (kind === "in" && course.type === "INTRO") {
    const lesson = await prisma.introLesson.findUnique({ where: { id }, select: { number: true, title: true, content: true } });
    return lesson ? { kind: "intro", ...lesson } : null;
  }

  if (kind === "kd" && course.type === "KIDS") {
    const story = await prisma.kidsStory.findFirst({ where: { id, courseId: course.id }, select: { number: true, title: true, text: true, images: true } });
    return story ? { kind: "kids", number: story.number, title: story.title, text: story.text, images: JSON.parse(story.images) as string[] } : null;
  }

  if (kind === "pc" && course.type === "PODCAST") {
    const episode = await prisma.podcastEpisode.findFirst({
      where: { id, podcastId: course.podcastId ?? undefined },
      select: { id: true, number: true, title: true, summary: true, audioUrl: true, chapters: true },
    });
    return episode ? { kind: "podcast", episodeId: episode.id, number: episode.number, title: episode.title, summary: episode.summary, audioUrl: episode.audioUrl, chapters: episode.chapters } : null;
  }

  return null;
}

/** De stap waar de host in deze cursus is, als voorstel voor de eerste ronde. */
export async function currentUnitKeyFor(userId: string, course: CourseRef): Promise<string | null> {
  if (["FRONT_TO_BACK", "FREE_CHOICE", "BY_BOOK", "READING_LESSONS"].includes(course.type)) {
    const progress = await prisma.userCourseProgress.findUnique({
      where: { userId_courseId: { userId, courseId: course.id } },
      select: { currentChapterId: true, currentLessonId: true },
    });
    if (course.type === "READING_LESSONS") return progress?.currentLessonId ? `rl:${progress.currentLessonId}` : null;
    return progress?.currentChapterId ? `ch:${progress.currentChapterId}` : null;
  }
  return null;
}
