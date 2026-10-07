/**
 * Welke Genees-vraag is aan de beurt? Zuivere logica, zonder database: de
 * server (runs.ts) levert de hoofdstukken van de actieve uitgave, de reeds
 * geziene vragen en de plek van de speler, en schrijft het resultaat weg.
 *
 * Regels (zie docs/SNELLE-ZENDELING.md):
 * - Hoofdstukken worden in de echte volgorde van de uitgave doorlopen:
 *   (Book.order, Chapter.order). Er is geen vaste lijst.
 * - Iedere poging krijgt een vraag die de speler nog niet zag (goed of fout
 *   beantwoord, of alleen getoond). Een gezien-vraag komt niet terug zolang er
 *   ergens in de uitgave een ongeziene vraag is.
 * - Goed antwoord: de volgende Genees gaat naar het volgende hoofdstuk.
 *   Fout antwoord: de plek blijft staan, dus bij hetzelfde hoofdstuk met een
 *   andere vraag, en pas als dat geen ongeziene vraag meer heeft naar het
 *   volgende hoofdstuk.
 * - Na het laatste hoofdstuk gaat de zoektocht terug naar het begin, met
 *   andere varianten zolang die er zijn. Is alles gezien, dan wordt het
 *   geheugen gecontroleerd teruggezet (nieuwe cyclus) en begint de uitgave
 *   opnieuw bij het eerste hoofdstuk.
 */

export interface ReviveChapterEntry {
  chapterId: string;
  bookOrder: number;
  chapterOrder: number;
  /** Alleen vragen die ook echt gesteld kunnen worden (goedgekeurd, bruikbare opties). */
  questionIds: string[];
}

export interface ReviveCursor {
  bookOrder: number;
  chapterOrder: number;
}

/** Begin van een uitgave: alle echte posities zijn >= 0. */
export const REVIVE_START: ReviveCursor = { bookOrder: 0, chapterOrder: 0 };

export function comparePosition(a: ReviveCursor, b: ReviveCursor): number {
  return a.bookOrder - b.bookOrder || a.chapterOrder - b.chapterOrder;
}

export interface RevivePick {
  chapterId: string;
  questionId: string;
  /** Alle vragen waren gezien: het geheugen is leeg en de cyclus loopt een op. */
  cycleReset: boolean;
}

export interface PickInput {
  chapters: ReviveChapterEntry[];
  /** Vragen die de speler in de huidige cyclus al zag. */
  seen: ReadonlySet<string>;
  cursor: ReviveCursor;
  random?: () => number;
  /** Laatst geziene vraag; wordt na een reset overgeslagen als er een alternatief is. */
  lastSeenQuestionId?: string | null;
}

function pickOne<T>(items: T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

export function pickReviveQuestion(input: PickInput): RevivePick | null {
  const random = input.random ?? Math.random;
  const chapters = input.chapters
    .filter((chapter) => chapter.questionIds.length > 0)
    .sort((a, b) => comparePosition(a, b));
  if (chapters.length === 0) return null;

  // Eerste hoofdstuk op of na de plek van de speler; staat die voorbij het
  // laatste hoofdstuk, dan begint een nieuwe doorloop bij het eerste.
  const found = chapters.findIndex((chapter) => comparePosition(chapter, input.cursor) >= 0);
  const start = found === -1 ? 0 : found;
  for (let step = 0; step < chapters.length; step++) {
    const chapter = chapters[(start + step) % chapters.length];
    const unseen = chapter.questionIds.filter((id) => !input.seen.has(id));
    if (unseen.length > 0) {
      return { chapterId: chapter.chapterId, questionId: pickOne(unseen, random), cycleReset: false };
    }
  }

  // Alles gezien: gecontroleerde reset, nieuwe cyclus vanaf het eerste hoofdstuk.
  const first = chapters[0];
  const fresh = first.questionIds.filter((id) => id !== input.lastSeenQuestionId);
  return { chapterId: first.chapterId, questionId: pickOne(fresh.length > 0 ? fresh : first.questionIds, random), cycleReset: true };
}

/**
 * Nieuwe plek na een antwoord. Goed: het hoofdstuk erna (de positie hoeft niet
 * te bestaan; de zoektocht neemt het eerstvolgende echte hoofdstuk). Fout: het
 * hoofdstuk blijft staan, zodat daar eerst een andere vraag aan de beurt komt.
 */
export function cursorAfterAnswer(chapter: { bookOrder: number; chapterOrder: number }, correct: boolean): ReviveCursor {
  return { bookOrder: chapter.bookOrder, chapterOrder: correct ? chapter.chapterOrder + 1 : chapter.chapterOrder };
}
