// Pure regels voor de drie schriftuurlijke leescursussen (Stap voor stap, Hoofdstuk voor hoofdstuk, Vrije keuze) die
// dezelfde visuele leespadcomponenten delen. Alleen presentatie en navigatie: afronding, vergrendeling en volgorde komen
// uit de bestaande cursuslogica (contentProgress, courses, readingLessons) en worden hier nooit opnieuw uitgevonden.
// Geen imports, zodat de browser, de server en de tests het vrij laden.

export type ReadingPathCourseType = "READING_LESSONS" | "FRONT_TO_BACK" | "FREE_CHOICE";

/** De cursustypes die het gedeelde leespad (en de bijbehorende Focusroute /courses/<id>/pad) gebruiken. */
export const READING_PATH_TYPES: readonly ReadingPathCourseType[] = ["READING_LESSONS", "FRONT_TO_BACK", "FREE_CHOICE"];

export function isReadingPathType(type: string): type is ReadingPathCourseType {
  return (READING_PATH_TYPES as readonly string[]).includes(type);
}

/** Cursussen waarin elk hoofdstuk één eenheid is (geen kunstmatige leesgedeelten): de hoofdstukroute. */
export function usesChapterPath(type: string): type is "FRONT_TO_BACK" | "FREE_CHOICE" {
  return type === "FRONT_TO_BACK" || type === "FREE_CHOICE";
}

/** "Kom dan en volg Mij" (CFM): één cursus per leeswijze, met de weekleerlijn als pad (zie src/components/study/CfmCourseView.tsx). */
export type StudyCourseType = "STUDY_STEPS" | "STUDY_FREE";
export const STUDY_COURSE_TYPES: readonly StudyCourseType[] = ["STUDY_STEPS", "STUDY_FREE"];
export function isStudyCourseType(type: string): type is StudyCourseType {
  return (STUDY_COURSE_TYPES as readonly string[]).includes(type);
}
/** De leeswijze die bij een studiecursus hoort (dezelfde waarden als User.personalStudyMode). */
export function modeOfStudyCourse(type: StudyCourseType): "STEPS" | "FREE" {
  return type === "STUDY_STEPS" ? "STEPS" : "FREE";
}

export type ReadState = "UNREAD" | "READING" | "READ";

export interface ChapterItem {
  id: string;
  number: number;
  bookKey: string | null;
  bookName: string;
  verseCount: number;
  read: ReadState;
  exercisesAnswered: number;
  exercisesTotal: number;
  exerciseScore: number | null;
  /** Gelezen én geoefend, via welke route ook (gedeelde inhoudsvoortgang). */
  completed: boolean;
}

export type ChapterCardState = "done" | "current" | "started" | "open" | "locked";

/**
 * Een hoofdstuk is vergrendeld zodra het vorige (in cursusvolgorde) niet af is, maar alleen in een vaste volgorde
 * (Hoofdstuk voor hoofdstuk). Vrije keuze kent geen slot. Vooraf berekend, niet tijdens het renderen van de kaarten.
 */
export function chapterLocks(chapters: readonly Pick<ChapterItem, "id" | "completed">[], sequential: boolean): Map<string, boolean> {
  const locked = new Map<string, boolean>();
  let previousCompleted = true;
  for (const chapter of chapters) {
    locked.set(chapter.id, sequential && !previousCompleted);
    previousCompleted = chapter.completed;
  }
  return locked;
}

/**
 * Het hoofdstuk dat nu aan de beurt is: de bestaande voortgangscursor als die nog niet af en niet vergrendeld is, anders
 * het eerste dat niet af is; null als alles af is. Alleen voor een vaste volgorde: Vrije keuze heeft geen "volgende".
 */
export function todayChapterId(chapters: readonly ChapterItem[], cursorId: string | null, locks: ReadonlyMap<string, boolean>): string | null {
  const cursor = cursorId ? chapters.find((chapter) => chapter.id === cursorId) : undefined;
  if (cursor && !cursor.completed && !locks.get(cursor.id)) return cursor.id;
  return chapters.find((chapter) => !chapter.completed)?.id ?? null;
}

export function chapterCardState(chapter: ChapterItem, opts: { locked: boolean; current: boolean }): ChapterCardState {
  if (opts.current) return "current";
  if (chapter.completed) return "done";
  if (opts.locked) return "locked";
  return chapter.read !== "UNREAD" || chapter.exercisesAnswered > 0 ? "started" : "open";
}

export interface BookGroup<T> {
  /** Stabiele sleutel: de taalonafhankelijke Book.key, anders de naam. */
  key: string;
  bookKey: string | null;
  name: string;
  chapters: T[];
}

/** Groepeert hoofdstukken onder hun boek, in de volgorde waarin de boeken in de cursus voorkomen. */
export function groupByBook<T extends { bookKey: string | null; bookName: string }>(chapters: readonly T[]): BookGroup<T>[] {
  const groups: BookGroup<T>[] = [];
  for (const chapter of chapters) {
    const key = chapter.bookKey ?? chapter.bookName;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.chapters.push(chapter);
    else groups.push({ key, bookKey: chapter.bookKey, name: chapter.bookName, chapters: [chapter] });
  }
  return groups;
}

/**
 * Welk boek standaard openstaat: dat van het eerste hoofdstuk-id (in volgorde van voorkeur) dat in de cursus voorkomt.
 * Hoofdstuk voor hoofdstuk geeft het hoofdstuk dat nu aan de beurt is; Vrije keuze de huidige positie in Stap voor stap,
 * anders het laatst gebruikte hoofdstuk. Zonder bruikbaar hoofdstuk: null (alles ingeklapt).
 */
export function defaultOpenBookKey<T extends { id: string }>(groups: readonly BookGroup<T>[], candidateChapterIds: readonly (string | null | undefined)[]): string | null {
  for (const id of candidateChapterIds) {
    if (!id) continue;
    const group = groups.find((g) => g.chapters.some((chapter) => chapter.id === id));
    if (group) return group.key;
  }
  return null;
}

/** Hoeveel hoofdstukken af zijn: voor de voortgangstelling (nooit de positie in de cursus). */
export function completedCount(chapters: readonly Pick<ChapterItem, "completed">[]): number {
  return chapters.filter((chapter) => chapter.completed).length;
}
