import { prisma } from "@/lib/db";
import { playableAudioUrl } from "@/lib/audioMirror";
import { BOFM_WORK, resolveEditionId } from "@/lib/contentCollections";
import { shuffle } from "@/lib/scrabble/tiles";
import { completeChapterGuess } from "@/lib/streak";
import type { ChapterGuessLevel } from "@/generated/prisma/client";

export const QUESTION_COUNT_OPTIONS = [5, 10, 15] as const;
export const BEGINNER_OPTION_COUNT = 4;

// Interne signaal-errors om binnen een transactie (zie chapterGuessHint)
// af te breken met een specifieke reden, zonder de foutmelding zelf al
// binnen de transactie te construeren.
class HintAlreadyUsedError extends Error {}
class NoHintCreditError extends Error {}

export interface ChapterLabel {
  chapterId: string;
  bookId: string;
  bookName: string;
  number: number;
  label: string;
}

export async function labelsFor(chapterIds: string[]): Promise<Map<string, ChapterLabel>> {
  const chapters = await prisma.chapter.findMany({
    where: { id: { in: chapterIds } },
    include: { book: true },
  });
  return new Map(
    chapters.map((c) => [
      c.id,
      { chapterId: c.id, bookId: c.bookId, bookName: c.book.name, number: c.number, label: `${c.book.name} ${c.number}` },
    ])
  );
}

export async function getChapterLabel(chapterId: string): Promise<ChapterLabel | null> {
  const map = await labelsFor([chapterId]);
  return map.get(chapterId) ?? null;
}

// Het "intro"-tekstje dat je te lezen krijgt = de officiële hoofdstukkop
// (samenvatting + jaartal, zie Chapter.heading) — dat is wat er in het echte
// Boek van Mormon boven het hoofdstuk staat, dus ook wat iemand die het boek
// kent zou herkennen. Val terug op vers 1 voor het (in de praktijk niet
// voorkomende) geval dat een hoofdstuk geen heading heeft.
export async function getChapterIntro(chapterId: string): Promise<string> {
  const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
  if (chapter?.heading) return chapter.heading;
  const verse = await prisma.verse.findFirst({ where: { chapterId }, orderBy: { number: "asc" } });
  return verse?.text ?? "";
}

export interface IntroAudio {
  url: string;
  start: number;
  end: number;
}

// Hetzelfde intro, voorgelezen: het stuk van de hoofdstukaudio met alleen de
// kop (zie Chapter.audioHeadingStart). Null als het hoofdstuk geen audio
// heeft; dan blijft het bij de tekst.
export async function getChapterIntroAudio(chapterId: string): Promise<IntroAudio | null> {
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    select: { audioUrl: true, audioHeadingStart: true, audioHeadingEnd: true },
  });
  if (!chapter?.audioUrl || chapter.audioHeadingStart == null || chapter.audioHeadingEnd == null) return null;
  return { url: playableAudioUrl(chapter.audioUrl), start: chapter.audioHeadingStart, end: chapter.audioHeadingEnd };
}

export async function pickRandomChapterIds(count: number, excludeIds: string[] = [], editionId?: string): Promise<string[]> {
  // Alleen het Boek van Mormon: het spel hoort bij dat werk, ook nu er
  // andere schriften in dezelfde tabellen staan. Zonder opgegeven uitgave de
  // Nederlandse (zie resolveEditionId).
  const collectionId = editionId ?? (await resolveEditionId(BOFM_WORK));
  const all = await prisma.chapter.findMany({
    where: { id: { notIn: excludeIds }, book: { contentCollectionId: collectionId ?? undefined } },
    select: { id: true },
  });
  return shuffle(all.map((c) => c.id)).slice(0, count);
}

export async function buildBeginnerOptionIds(correctChapterId: string): Promise<string[]> {
  // Foute keuzes uit dezelfde uitgave als het goede antwoord.
  const correct = await prisma.chapter.findUnique({
    where: { id: correctChapterId },
    select: { book: { select: { contentCollectionId: true } } },
  });
  const wrong = await pickRandomChapterIds(BEGINNER_OPTION_COUNT - 1, [correctChapterId], correct?.book.contentCollectionId);
  return shuffle([correctChapterId, ...wrong]);
}

export interface QuestionView {
  index: number;
  total: number;
  introText: string;
  introAudio: IntroAudio | null;
  options: ChapterLabel[] | null; // alleen bij BEGINNER
  hintUsed: boolean;
}

async function buildQuestionView(
  question: { order: number; chapterId: string; optionIds: string | null; hintUsed: boolean },
  total: number
): Promise<QuestionView> {
  const [introText, introAudio] = await Promise.all([
    getChapterIntro(question.chapterId),
    getChapterIntroAudio(question.chapterId),
  ]);
  let options: ChapterLabel[] | null = null;
  if (question.optionIds) {
    const ids = JSON.parse(question.optionIds) as string[];
    const labels = await labelsFor(ids);
    options = ids.map((id) => labels.get(id)!).filter(Boolean);
  }
  return { index: question.order, total, introText, introAudio, options, hintUsed: question.hintUsed };
}

export async function createChapterGuessGame(userId: string, level: ChapterGuessLevel, questionCount: number) {
  const chapterIds = await pickRandomChapterIds(questionCount);

  const game = await prisma.$transaction(async (tx) => {
    const created = await tx.chapterGuessGame.create({
      data: { userId, level, questionCount },
    });
    for (let order = 0; order < chapterIds.length; order++) {
      const chapterId = chapterIds[order];
      const optionIds = level === "BEGINNER" ? await buildBeginnerOptionIds(chapterId) : null;
      await tx.chapterGuessQuestion.create({
        data: { gameId: created.id, order, chapterId, optionIds: optionIds ? JSON.stringify(optionIds) : null },
      });
    }
    return created;
  });

  return getChapterGuessGameView(game.id, userId);
}

export interface ChapterGuessGameView {
  gameId: string;
  level: ChapterGuessLevel;
  questionCount: number;
  currentIndex: number;
  hintCredits: number;
  status: "IN_PROGRESS" | "FINISHED";
  question: QuestionView | null;
  summary: { correctCount: number; total: number } | null;
}

// Eén gedeeld hint-tegoed (User.hintBalance, zie src/lib/shop.ts) — verdiend
// (dit potje) of gekocht (winkel) komt op dezelfde plek terecht, en overal
// waar hints gebruikt kunnen worden (Woordspel, Raad het hoofdstuk, live
// quiz) wordt exact ditzelfde getal getoond. Vroeger was dit een los
// per-spel tegoed dat pas bij uitputting het algemene tegoed aansprak,
// waardoor het getal per scherm kon verschillen.
async function getHintBalance(userId: string): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true } });
  return user.hintBalance;
}

export async function getChapterGuessGameView(gameId: string, userId: string): Promise<ChapterGuessGameView | { error: string }> {
  const game = await prisma.chapterGuessGame.findUnique({ where: { id: gameId } });
  if (!game || game.userId !== userId) return { error: "Spel niet gevonden." };
  const hintCredits = await getHintBalance(userId);

  if (game.status === "FINISHED") {
    const correctCount = await prisma.chapterGuessQuestion.count({ where: { gameId, correct: true } });
    return {
      gameId: game.id,
      level: game.level,
      questionCount: game.questionCount,
      currentIndex: game.currentIndex,
      hintCredits,
      status: "FINISHED",
      question: null,
      summary: { correctCount, total: game.questionCount },
    };
  }

  const question = await prisma.chapterGuessQuestion.findUnique({
    where: { gameId_order: { gameId, order: game.currentIndex } },
  });
  if (!question) return { error: "Vraag niet gevonden." };

  return {
    gameId: game.id,
    level: game.level,
    questionCount: game.questionCount,
    currentIndex: game.currentIndex,
    hintCredits,
    status: "IN_PROGRESS",
    question: await buildQuestionView(question, game.questionCount),
    summary: null,
  };
}

export interface AnswerResult {
  correct: boolean;
  correctChapter: ChapterLabel;
  finished: boolean;
  nextQuestion: QuestionView | null;
  hintCredits: number;
  summary: {
    correctCount: number;
    total: number;
    xpEarned: number;
    currentStreak: number;
    newAchievements: string[];
    alreadyStudiedToday: boolean;
    dayEarned?: boolean;
  } | null;
}

export async function submitChapterGuessAnswer(
  gameId: string,
  userId: string,
  chosenChapterId: string
): Promise<AnswerResult | { error: string }> {
  const game = await prisma.chapterGuessGame.findUnique({ where: { id: gameId } });
  if (!game || game.userId !== userId) return { error: "Spel niet gevonden." };
  if (game.status !== "IN_PROGRESS") return { error: "Dit spel is al afgelopen." };

  const question = await prisma.chapterGuessQuestion.findUnique({
    where: { gameId_order: { gameId, order: game.currentIndex } },
  });
  if (!question) return { error: "Vraag niet gevonden." };
  if (question.answeredChapterId !== null) return { error: "Deze vraag is al beantwoord." };

  const correct = chosenChapterId === question.chapterId;
  const correctChapter = await getChapterLabel(question.chapterId);
  if (!correctChapter) return { error: "Hoofdstuk niet gevonden." };

  const nextIndex = game.currentIndex + 1;
  const finished = nextIndex >= game.questionCount;
  // Geen hint-tegoed meer op EXPERT: hints mogen daar toch niet gebruikt worden.
  const earnsHintCredit = correct && game.level !== "EXPERT";

  await prisma.$transaction(async (tx) => {
    await tx.chapterGuessQuestion.update({
      where: { id: question.id },
      data: { answeredChapterId: chosenChapterId, correct },
    });
    await tx.chapterGuessGame.update({
      where: { id: gameId },
      data: {
        currentIndex: nextIndex,
        status: finished ? "FINISHED" : undefined,
        finishedAt: finished ? new Date() : undefined,
      },
    });
    if (earnsHintCredit) {
      await tx.user.update({ where: { id: userId }, data: { hintBalance: { increment: 1 } } });
    }
  });
  const hintCredits = await getHintBalance(userId);

  if (finished) {
    const correctCount = await prisma.chapterGuessQuestion.count({ where: { gameId, correct: true } });
    const result = await completeChapterGuess(userId, correctCount, game.questionCount, game.level, `chapter-guess:${gameId}`);
    return {
      correct,
      correctChapter,
      finished: true,
      nextQuestion: null,
      hintCredits,
      summary: {
        correctCount,
        total: game.questionCount,
        xpEarned: result.xpEarned,
        currentStreak: result.currentStreak,
        newAchievements: result.newAchievements,
        alreadyStudiedToday: result.alreadyStudiedToday,
        dayEarned: result.dayEarned,
      },
    };
  }

  const nextQuestionRow = await prisma.chapterGuessQuestion.findUnique({
    where: { gameId_order: { gameId, order: nextIndex } },
  });
  const nextQuestion = nextQuestionRow ? await buildQuestionView(nextQuestionRow, game.questionCount) : null;

  return { correct, correctChapter, finished: false, nextQuestion, hintCredits, summary: null };
}

export interface ForfeitResult {
  correctCount: number;
  total: number;
}

// Opgeven: het spel wordt meteen FINISHED gezet zónder completeChapterGuess
// aan te roepen — dat is de enige plek die XP/streak/prestaties toekent (zie
// submitChapterGuessAnswer hierboven), dus door die aanroep hier over te
// slaan wordt er domweg nooit een beloning uitgekeerd voor dit potje. Zo
// "verlies" je de XP die je tot dan toe had kunnen winnen: die was toch pas
// aan het eind toegekend, dus er hoeft niets te worden teruggeboekt.
export async function forfeitChapterGuessGame(gameId: string, userId: string): Promise<ForfeitResult | { error: string }> {
  const game = await prisma.chapterGuessGame.findUnique({ where: { id: gameId } });
  if (!game || game.userId !== userId) return { error: "Spel niet gevonden." };
  if (game.status !== "IN_PROGRESS") return { error: "Dit spel is al afgelopen." };

  const correctCount = await prisma.chapterGuessQuestion.count({ where: { gameId, correct: true } });

  await prisma.chapterGuessGame.update({
    where: { id: gameId },
    data: { status: "FINISHED", finishedAt: new Date() },
  });

  return { correctCount, total: game.questionCount };
}

export interface HintResult {
  eliminatedChapterId?: string; // BEGINNER
  bookId?: string; // ADVANCED
  bookName?: string; // ADVANCED
}

export async function chapterGuessHint(
  gameId: string,
  userId: string
): Promise<(HintResult & { hintCredits: number }) | { error: string }> {
  const game = await prisma.chapterGuessGame.findUnique({ where: { id: gameId } });
  if (!game || game.userId !== userId) return { error: "Spel niet gevonden." };
  if (game.status !== "IN_PROGRESS") return { error: "Dit spel is al afgelopen." };
  if (game.level === "EXPERT") return { error: "Hints zijn niet beschikbaar op expert-niveau." };

  const question = await prisma.chapterGuessQuestion.findUnique({
    where: { gameId_order: { gameId, order: game.currentIndex } },
  });
  if (!question) return { error: "Vraag niet gevonden." };
  if (question.hintUsed) return { error: "Je hebt voor deze vraag al een hint gebruikt." };

  // Alles hieronder gebeurt in één transactie zodat het claimen van de vraag
  // (hintUsed: false -> true) en het afschrijven van een tegoed onlosmakelijk
  // samen slagen of samen mislukken: zonder dat zou een gelijktijdige
  // aanvraag voor dezelfde vraag (bv. een dubbelklik) een tegoed dubbel
  // kunnen verbruiken, of — als we de vraag zouden claimen vóórdat we weten
  // of er een tegoed is — de vraag permanent kunnen "opbranden" zonder dat
  // er ooit een hint is gegeven.
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.chapterGuessQuestion.updateMany({
        where: { id: question.id, hintUsed: false },
        data: { hintUsed: true },
      });
      if (claimed.count === 0) throw new HintAlreadyUsedError();

      // Eén gedeeld tegoed (User.hintBalance, zie src/lib/shop.ts).
      const userCreditResult = await tx.user.updateMany({
        where: { id: userId, hintBalance: { gt: 0 } },
        data: { hintBalance: { decrement: 1 } },
      });
      if (userCreditResult.count === 0) throw new NoHintCreditError();
    });
  } catch (e) {
    if (e instanceof HintAlreadyUsedError) return { error: "Je hebt voor deze vraag al een hint gebruikt." };
    if (e instanceof NoHintCreditError) {
      return { error: "Je hebt geen hint beschikbaar — geef eerst een goed antwoord, of koop er een in de winkel." };
    }
    throw e;
  }

  const hintCredits = await getHintBalance(userId);

  const optionIds = question.optionIds ? (JSON.parse(question.optionIds) as string[]) : null;
  const effect = computeHintEffect(game.level, question.chapterId, optionIds, await getChapterLabel(question.chapterId));
  return { ...effect, hintCredits };
}

// Wat een hint onthult — gedeeld tussen deze (DB-backed, alleen-spelen)
// hint-functie hierboven en de live-varianten in src/server/gameServer.ts,
// zodat "wat een hint doet" op precies één plek staat.
export function computeHintEffect(
  level: ChapterGuessLevel,
  correctChapterId: string,
  optionIds: string[] | null,
  correctChapter: ChapterLabel | null
): HintResult {
  if (level === "BEGINNER") {
    const wrongIds = (optionIds ?? []).filter((id) => id !== correctChapterId);
    const eliminatedChapterId = wrongIds[Math.floor(Math.random() * wrongIds.length)];
    return { eliminatedChapterId };
  }
  return { bookId: correctChapter?.bookId, bookName: correctChapter?.bookName };
}

// Genereert een volledige, in-het-geheugen vragenlijst voor een live potje
// (zie src/server/gameServer.ts) — geen database-rijen per vraag nodig zoals
// bij het alleen-spelen-spel, want een live kamer leeft toch al alleen in het
// geheugen van het proces (net als de bestaande hoofdstuk-oefeningen-race).
export interface LiveQuestionSeed {
  chapterId: string;
  introText: string;
  introAudio: IntroAudio | null;
  optionIds: string[] | null; // alleen bij BEGINNER
}

export async function generateChapterGuessQuestions(level: ChapterGuessLevel, count: number): Promise<LiveQuestionSeed[]> {
  const chapterIds = await pickRandomChapterIds(count);
  const questions: LiveQuestionSeed[] = [];
  for (const chapterId of chapterIds) {
    const introText = await getChapterIntro(chapterId);
    const introAudio = await getChapterIntroAudio(chapterId);
    const optionIds = level === "BEGINNER" ? await buildBeginnerOptionIds(chapterId) : null;
    questions.push({ chapterId, introText, introAudio, optionIds });
  }
  return questions;
}
