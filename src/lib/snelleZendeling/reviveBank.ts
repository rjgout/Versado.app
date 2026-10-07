/**
 * Formaat en controle van de gecureerde Genees-vragenbank (prisma/genees/).
 * Zuivere functies zonder database: de CLI (scripts/genees/check.ts), de
 * importer en de tests gebruiken dezelfde regels.
 *
 * Een vraag heeft precies drie antwoorden (één goed, twee fout), hoort bij
 * één hoofdstuk en noemt de verzen waar het antwoord staat. `check` bevat
 * woorden uit het goede antwoord (namen, getallen, kernwoorden) die letterlijk
 * in die verzen moeten voorkomen: zo is elk feit aan de brontekst gebonden.
 */

export interface GeneesQuestionSeed {
  /** Korte, stabiele id binnen het hoofdstuk ("a", "b", ...); nooit hergebruiken. */
  id: string;
  /** Verzen waar het antwoord staat, bv. "1-3,7". */
  verses: string;
  prompt: string;
  correct: string;
  wrong: [string, string];
  /** Woorden uit het goede antwoord die in `verses` moeten staan. */
  check: string[];
}

export interface GeneesChapterSeed {
  /** Boek zonder werkvoorvoegsel, bv. "1-ne" voor Book.key "bofm/1-ne". */
  book: string;
  chapter: number;
  questions: GeneesQuestionSeed[];
}

export interface GeneesBankSeed {
  /** Voorvoegsel van de contentsleutels, bv. "bofm-nl". */
  id: string;
  /** Werk voor Book.key, bv. "bofm". */
  work: string;
  /** ContentCollection waar de hoofdstukken in staan. */
  collectionId: string;
  chapters: GeneesChapterSeed[];
}

/** Gewenst aantal varianten per hoofdstuk: één per poging, plus ruimte na een fout antwoord. */
export const TARGET_VARIANTS = 3;

export function bankContentKey(bank: Pick<GeneesBankSeed, "id">, chapter: Pick<GeneesChapterSeed, "book" | "chapter">, question: Pick<GeneesQuestionSeed, "id">): string {
  return `${bank.id}:${chapter.book}:${chapter.chapter}:${question.id}`;
}

export function bookKeyOf(bank: Pick<GeneesBankSeed, "work">, chapter: Pick<GeneesChapterSeed, "book">): string {
  return `${bank.work}/${chapter.book}`;
}

/** "1-3,7" -> [1,2,3,7]; null bij een ongeldige aanduiding. */
export function parseVerseSpec(spec: string): number[] | null {
  if (!/^\d+(-\d+)?(,\s*\d+(-\d+)?)*$/.test(spec.trim())) return null;
  const numbers: number[] = [];
  for (const part of spec.split(",")) {
    const [from, to] = part.trim().split("-").map(Number);
    const end = to ?? from;
    if (end < from || end - from > 80) return null;
    for (let n = from; n <= end; n++) numbers.push(n);
  }
  return numbers;
}

export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function words(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

/** Antwoordlengte mag het goede antwoord niet verraden (te lang, te kort of een uitschieter). */
export function lengthHintProblem(correct: string, wrong: readonly string[]): string | null {
  const c = correct.trim().length;
  const w = wrong.map((label) => label.trim().length);
  const all = [c, ...w];
  const mean = w.reduce((sum, n) => sum + n, 0) / w.length;
  if (Math.max(...all) / Math.max(1, Math.min(...all)) > 1.7) return `antwoordlengtes lopen te ver uiteen (${all.join("/")} tekens)`;
  if (c > Math.max(...w) * 1.2) return `het goede antwoord is duidelijk het langste (${all.join("/")} tekens)`;
  if (c < Math.min(...w) * 0.8) return `het goede antwoord is duidelijk het kortste (${all.join("/")} tekens)`;
  if (c / mean > 1.3 || c / mean < 0.75) return `het goede antwoord wijkt in lengte af van de afleiders (${all.join("/")} tekens)`;
  return null;
}

/** 0..1: hoeveel betekenisvolle woorden twee vragen delen (Jaccard). */
export function promptSimilarity(a: string, b: string): number {
  const set = (text: string) => new Set(words(text).filter((word) => word.length > 3));
  const x = set(a);
  const y = set(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const word of x) if (y.has(word)) shared++;
  return shared / (x.size + y.size - shared);
}

const FORBIDDEN_LABEL = /\b(alle (bovenstaande|antwoorden)|geen van (de |bovenstaande|beide)|beide antwoorden|hierboven)\b/i;

export type VerseProvider = (book: string, chapter: number) => string[] | null;

export interface BankProblem {
  where: string;
  message: string;
}

export function validateGeneesBank(bank: GeneesBankSeed, versesFor: VerseProvider): BankProblem[] {
  const problems: BankProblem[] = [];
  const seenKeys = new Set<string>();
  const seenChapters = new Set<string>();
  for (const chapter of bank.chapters) {
    const chapterWhere = `${bank.id} ${chapter.book} ${chapter.chapter}`;
    const chapterKey = `${chapter.book}:${chapter.chapter}`;
    if (seenChapters.has(chapterKey)) problems.push({ where: chapterWhere, message: "hoofdstuk staat twee keer in het bestand" });
    seenChapters.add(chapterKey);

    const verses = versesFor(chapter.book, chapter.chapter);
    if (!verses) {
      problems.push({ where: chapterWhere, message: "hoofdstuk bestaat niet in de bronverzen" });
      continue;
    }
    if (chapter.questions.length === 0) problems.push({ where: chapterWhere, message: "hoofdstuk zonder vragen" });

    for (const question of chapter.questions) {
      const where = `${chapterWhere}${question.id}`;
      const fail = (message: string) => problems.push({ where, message });
      const key = bankContentKey(bank, chapter, question);
      if (!/^[a-z][a-z0-9]{0,3}$/.test(question.id)) fail("id moet een korte kleine-lettersleutel zijn (a, b, ...)");
      if (seenKeys.has(key)) fail("id komt dubbel voor in dit hoofdstuk");
      seenKeys.add(key);

      const labels = [question.correct, ...question.wrong];
      if (question.wrong.length !== 2) fail("precies twee foute antwoorden nodig");
      if (question.prompt.trim().length < 15 || !question.prompt.trim().endsWith("?")) fail("vraag is te kort of eindigt niet op een vraagteken");
      if (labels.some((label) => !label || label.trim().length < 2)) fail("leeg antwoord");
      if (new Set(labels.map(normalizeText)).size !== labels.length) fail("twee antwoorden zijn gelijk");
      if (labels.some((label) => FORBIDDEN_LABEL.test(label))) fail("verboden antwoordvorm (zoals 'alle bovenstaande')");
      const hint = labels.every((label) => label.trim()) ? lengthHintProblem(question.correct, question.wrong) : null;
      if (hint) fail(hint);

      const numbers = parseVerseSpec(question.verses);
      if (!numbers) fail(`ongeldige verzenaanduiding "${question.verses}"`);
      else if (numbers.some((n) => n < 1 || n > verses.length)) fail(`vers buiten het hoofdstuk (${verses.length} verzen): "${question.verses}"`);
      else {
        const source = normalizeText(numbers.map((n) => verses[n - 1]).join(" "));
        if (question.check.length === 0) fail("geen controlewoorden (check) opgegeven");
        for (const token of question.check) {
          if (!source.includes(normalizeText(token))) fail(`"${token}" staat niet in vers ${question.verses}`);
        }
        const answerText = normalizeText(question.correct);
        const unchecked = question.check.filter((token) => !answerText.includes(normalizeText(token)));
        if (unchecked.length > 0 && question.check.length === unchecked.length) fail("controlewoorden komen niet in het goede antwoord voor");
      }
    }

    // Varianten van één hoofdstuk moeten echt verschillen.
    for (let i = 0; i < chapter.questions.length; i++) {
      for (let j = i + 1; j < chapter.questions.length; j++) {
        const a = chapter.questions[i];
        const b = chapter.questions[j];
        if (promptSimilarity(a.prompt, b.prompt) > 0.6) problems.push({ where: `${chapterWhere}${a.id}/${b.id}`, message: "twee vragen lijken te veel op elkaar" });
        if (normalizeText(a.correct) === normalizeText(b.correct)) problems.push({ where: `${chapterWhere}${a.id}/${b.id}`, message: "dezelfde goede antwoorden" });
      }
    }
  }
  return problems;
}

/** Dekking per hoofdstuk: hoeveel varianten, en welke hoofdstukken onder het doel blijven. */
export function coverageOf(bank: GeneesBankSeed, allChapters: { book: string; chapter: number }[]): { total: number; covered: number; atTarget: number; below: { book: string; chapter: number; variants: number }[] } {
  const counts = new Map(bank.chapters.map((chapter) => [`${chapter.book}:${chapter.chapter}`, chapter.questions.length]));
  const below = allChapters
    .map((chapter) => ({ ...chapter, variants: counts.get(`${chapter.book}:${chapter.chapter}`) ?? 0 }))
    .filter((chapter) => chapter.variants < TARGET_VARIANTS);
  return {
    total: allChapters.length,
    covered: allChapters.filter((chapter) => (counts.get(`${chapter.book}:${chapter.chapter}`) ?? 0) > 0).length,
    atTarget: allChapters.length - below.length,
    below,
  };
}
