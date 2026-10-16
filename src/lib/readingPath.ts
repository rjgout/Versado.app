// Pure regels voor het leerpad van Stap voor stap (ReadingCourseView). Alleen presentatie:
// beschikbaarheid en afronding komen uit getStepOverview (readingLessons.ts) en worden hier
// nooit opnieuw bepaald. Geen imports, zodat de browser en de tests het vrij laden.

export interface PathStep {
  id: string;
  /** 1-gebaseerd binnen het hoofdstuk. */
  number: number;
  startVerse: number;
  endVerse: number;
  done: boolean;
  available: boolean;
}

export interface PathChapter {
  id: string;
  number: number;
  bookName: string;
  bookKey: string | null;
  lessonCount: number;
  completedLessons: number;
  locked: boolean;
  /** Gedeelde lees- en oefenvoortgang van deze inhoud, uit elke route (zie contentProgress.ts). */
  read: "UNREAD" | "READING" | "READ";
  exercisesAnswered: number;
  exercisesTotal: number;
  steps: PathStep[];
}

export type PathChapterState = "done" | "current" | "open" | "locked";
export type PathStepState = "done" | "current" | "open" | "locked";

/** Het hoofdstuk waar de volgende stap van de gebruiker in zit, of null als alles af is. */
export function currentChapterId(chapters: readonly PathChapter[], currentStepId: string | null): string | null {
  if (!currentStepId) return null;
  return chapters.find((chapter) => chapter.steps.some((step) => step.id === currentStepId))?.id ?? null;
}

export function chapterState(chapter: PathChapter, currentStepId: string | null): PathChapterState {
  if (currentStepId && chapter.steps.some((step) => step.id === currentStepId)) return "current";
  if (chapter.lessonCount > 0 && chapter.completedLessons === chapter.lessonCount) return "done";
  return chapter.locked ? "locked" : "open";
}

export function stepState(step: PathStep, currentStepId: string | null): PathStepState {
  if (step.id === currentStepId) return "current";
  if (step.done) return "done";
  return step.available ? "open" : "locked";
}

/** Een afgerond of reeds begonnen (open) hoofdstuk kan worden uitgeklapt; een vergrendeld hoofdstuk niet. */
export function isExpandable(state: PathChapterState): boolean {
  return state !== "locked";
}

/** Hoeveel procent van de stappen van dit hoofdstuk af is. */
export function chapterPercent(chapter: Pick<PathChapter, "lessonCount" | "completedLessons">): number {
  return chapter.lessonCount > 0 ? Math.round((chapter.completedLessons / chapter.lessonCount) * 100) : 0;
}

export interface ScrollGeometry {
  /** Bovenkant (documentcoördinaat) van het hoofdstuk vóór het huidige, of null als er geen is. */
  previousTop: number | null;
  /** Bovenkant van de huidige hoofdstukkaart. */
  cardTop: number;
  /** Boven- en onderkant van de actieve stap (documentcoördinaten). */
  stepTop: number;
  stepBottom: number;
  /** Ruimte die de vaste balken innemen. */
  header: number;
  nav: number;
  viewport: number;
  margin?: number;
}

/**
 * De scrollpositie waarbij de actieve stap direct zichtbaar is, met het hoofdstuk ervoor in beeld
 * als de schermhoogte dat toelaat. De actieve stap gaat altijd voor: past hij niet samen met het
 * vorige hoofdstuk, dan verdwijnt het vorige hoofdstuk uit beeld. Nooit onder de bovenbalk of
 * boven de onderbalk, nooit negatief.
 */
export function pathScrollTarget(g: ScrollGeometry): number {
  const margin = g.margin ?? 12;
  const wanted = (g.previousTop ?? g.cardTop) - g.header - margin;
  // de onderkant van de stap moet boven de onderbalk blijven…
  const needed = g.stepBottom + margin - (g.viewport - g.nav);
  // …en de bovenkant onder de bovenbalk.
  const highest = g.stepTop - g.header - margin;
  return Math.max(0, Math.min(Math.max(wanted, needed), highest));
}

export type MyStepDirection = "up" | "down";

/**
 * Welke kant de gebruiker op moet om de actieve stap te bereiken, vanuit de werkelijke plek van die stap
 * (viewportcoördinaten) ten opzichte van het zichtbare gebied tussen de vaste balken. Staat de stap (deels) in
 * beeld, dan is er geen knop nodig (null). Staat hij boven het zichtbare gebied, dan zit de gebruiker eronder: omhoog.
 */
export function myStepDirection(g: { top: number; bottom: number; header: number; nav: number; viewport: number }): MyStepDirection | null {
  const visibleTop = g.header;
  const visibleBottom = g.viewport - g.nav;
  if (g.bottom <= visibleTop) return "up";
  if (g.top >= visibleBottom) return "down";
  return null;
}

/** De gegevens die de cursushub al heeft opgehaald (CourseLesson, StepOverview, hoofdstukstatus). */
export interface PathLessonInput {
  id: string;
  chapterId: string;
  startVerse: number;
  endVerse: number;
  chapter: { number: number; book: { name: string; key: string | null } };
}

/**
 * Groepeert de bestaande lessen per hoofdstuk, in cursusvolgorde. Er worden nooit stappen, activiteiten
 * of statussen bijgemaakt: elke les is precies één stap en de status komt ongewijzigd uit de server.
 */
export function buildPathChapters(
  lessons: readonly PathLessonInput[],
  stepById: ReadonlyMap<string, { done: boolean; available: boolean }>,
  chapterState: (chapterId: string) => { read: PathChapter["read"]; exercisesAnswered: number; exercisesTotal: number }
): PathChapter[] {
  const chapters = new Map<string, PathChapter>();
  for (const lesson of lessons) {
    const step = stepById.get(lesson.id);
    if (!step) throw new Error(`Geen stapstatus voor les ${lesson.id}`);
    let chapter = chapters.get(lesson.chapterId);
    if (!chapter) {
      const state = chapterState(lesson.chapterId);
      chapter = {
        id: lesson.chapterId,
        number: lesson.chapter.number,
        bookName: lesson.chapter.book.name,
        bookKey: lesson.chapter.book.key,
        lessonCount: 0,
        completedLessons: 0,
        // zoals het cursusoverzicht altijd deed: een hoofdstuk is open zodra zijn eerste stap open is
        locked: !step.available,
        read: state.read,
        exercisesAnswered: state.exercisesAnswered,
        exercisesTotal: state.exercisesTotal,
        steps: [],
      };
      chapters.set(lesson.chapterId, chapter);
    }
    chapter.lessonCount += 1;
    if (step.done) chapter.completedLessons += 1;
    chapter.steps.push({
      id: lesson.id,
      number: chapter.lessonCount,
      startVerse: lesson.startVerse,
      endVerse: lesson.endVerse,
      done: step.done,
      available: step.available,
    });
  }
  return [...chapters.values()];
}
