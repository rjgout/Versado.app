import type { GeneesChapterSeed, GeneesQuestionSeed } from "../../src/lib/snelleZendeling/reviveBank";

/** Korte schrijfwijze voor een vraag: id, verzen, vraag, goed, twee fout, controlewoorden uit het goede antwoord. */
export function q(id: string, verses: string, prompt: string, correct: string, wrong: [string, string], check: string[]): GeneesQuestionSeed {
  return { id, verses, prompt, correct, wrong, check };
}

export function ch(book: string, chapter: number, ...questions: GeneesQuestionSeed[]): GeneesChapterSeed {
  return { book, chapter, questions };
}
