import { canResumeGameContent } from "@/lib/gameAvailability";
import { prisma } from "@/lib/db";
import { getContentContext, BOFM_WORK } from "@/lib/contentCollections";
import { dayKey } from "@/lib/dates";
import { awardCompetitionXp } from "@/lib/competitionXp";
import { awardXp } from "@/lib/xp";
import { generateWordSearch, selectionMatches, type WordSearchCandidate, type WordSearchDifficulty, type WordSearchPlacedWord, type WordSearchPosition } from "./generator";
import { resolveGameContent } from "@/lib/gameContentResolver";
import { collectionAccessWhere } from "@/lib/contentAccess";
import { gameSettingEnabled } from "@/lib/gameAvailabilityPolicy";
import { getGameSettings } from "@/lib/gameSettings";

interface StoredGame {
  id: string;
  userId: string;
  difficulty: WordSearchDifficulty;
  size: number;
  grid: string;
  words: string;
  foundWords: string;
  status: "IN_PROGRESS" | "COMPLETED" | "ABANDONED";
  xpEarned: number;
  finishedAt: Date | null;
}

export interface WordSearchView {
  id: string;
  difficulty: WordSearchDifficulty;
  size: number;
  grid: string[][];
  /** Positie alleen bij gevonden woorden, of bij een afgelopen puzzel. */
  words: (WordSearchCandidate & Partial<Pick<WordSearchPlacedWord, "start" | "end">>)[];
  foundWords: string[];
  status: StoredGame["status"];
  xpEarned: number;
  finishedAt: string | null;
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toView(game: StoredGame): WordSearchView {
  const foundWords = parseJson<string[]>(game.foundWords, []);
  const finished = game.status !== "IN_PROGRESS";
  return {
    id: game.id,
    difficulty: game.difficulty,
    size: game.size,
    grid: parseJson<string[][]>(game.grid, []),
    // Waar een nog niet gevonden woord ligt, is precies de oplossing: die
    // hoort pas na afloop in het antwoord aan de browser te staan.
    words: parseJson<WordSearchPlacedWord[]>(game.words, []).map((word) =>
      finished || foundWords.includes(word.normalized)
        ? word
        : { display: word.display, normalized: word.normalized }
    ),
    foundWords,
    status: game.status,
    xpEarned: game.xpEarned,
    finishedAt: game.finishedAt?.toISOString() ?? null,
  };
}

function xpForDifficulty(difficulty: WordSearchDifficulty): number {
  return difficulty === "EASY" ? 10 : difficulty === "MEDIUM" ? 15 : 20;
}

export async function assertWordSearchContext(userId: string) {
  const context = await getContentContext(userId);
  if (context.active.work !== BOFM_WORK || !context.gameKeys.includes("word-search")) return null;
  return context;
}

export async function getActiveWordSearch(userId: string): Promise<WordSearchView | null> {
  const game = await prisma.wordSearchGame.findFirst({
    where: { userId, status: "IN_PROGRESS" },
    orderBy: { createdAt: "desc" },
  });
  return game && await canResumeGameContent(game.contentCollectionId) ? toView(game) : null;
}

export async function startWordSearch(userId: string, difficulty: WordSearchDifficulty, theme = "RANDOM") {
  const active = await getActiveWordSearch(userId);
  if (active) return active;
  const content = await resolveGameContent({userId,gameId:"word-search",mode:"start"});
  if (!content.available || !content.context || !content.wordCandidates) throw new Error("Woordzoeker is niet beschikbaar voor deze content.");

  const candidates = content.wordCandidates;
  const recent = await prisma.wordSearchGame.findMany({
    where: { userId, difficulty, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { words: true },
  });
  const avoidSignatures = recent.map((game) =>
    parseJson<WordSearchPlacedWord[]>(game.words, []).map((word) => word.normalized).sort().join("|")
  );
  const seed = (Math.floor(Math.random() * 0x7fffffff) || 1) | 0;
  const puzzle = generateWordSearch(candidates, difficulty, seed, avoidSignatures);
  const game = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const existing = await tx.wordSearchGame.findFirst({ where: { userId, status: "IN_PROGRESS" }, orderBy: { createdAt: "desc" } });
    if (existing) {
      await tx.$queryRaw`SELECT id FROM "ContentCollection" WHERE id=${existing.contentCollectionId} FOR SHARE`;
      if (!await tx.contentCollection.findFirst({where:{id:existing.contentCollectionId,...collectionAccessWhere({isAdmin:false})},select:{id:true}}))throw new Error("Woordzoeker is niet beschikbaar voor deze content.");
      return existing;
    }
    await tx.$queryRaw`SELECT id FROM "ContentCollection" WHERE id=${content.context!.collectionId} FOR SHARE`;
    const source = await tx.contentCollection.findFirst({where:{id:content.context!.collectionId,...collectionAccessWhere({isAdmin:false})}});
    const scope = await tx.gameContentScope.findUnique({where:{gameKey_contentCollectionId:{gameKey:"word-search",contentCollectionId:content.context!.collectionId}}});
    if(!source || source.editionKey!==content.context!.editionKey || source.language!==content.context!.language || !scope || !gameSettingEnabled("word-search",await getGameSettings(tx)))throw new Error("Woordzoeker is niet beschikbaar voor deze content.");
    return tx.wordSearchGame.create({
    data: {
      userId,
      contentCollectionId: content.context!.collectionId,
      sourceContext: {...content.context!,normalizationVersion:1},
      difficulty,
      theme,
      size: puzzle.size,
      seed,
      grid: JSON.stringify(puzzle.grid),
      words: JSON.stringify(puzzle.words),
    },
  });
  });
  return toView(game);
}

export async function getWordSearch(userId: string, gameId: string) {
  const game = await prisma.wordSearchGame.findFirst({ where: { id: gameId, userId } });
  return game && await canResumeGameContent(game.contentCollectionId) ? toView(game) : null;
}

export async function abandonWordSearch(userId: string, gameId: string) {
  const game = await prisma.wordSearchGame.findFirst({ where: { id: gameId, userId, status: "IN_PROGRESS" } });
  if (!game || !(await canResumeGameContent(game.contentCollectionId))) return null;
  return prisma.wordSearchGame.update({
    where: { id: game.id },
    data: { status: "ABANDONED", finishedAt: new Date() },
  });
}

export async function findWordSearchWord(userId: string, gameId: string, start: WordSearchPosition, end: WordSearchPosition) {
  // Twee verzoeken tegelijk (dubbelklik, een herhaald verzoek na een
  // netwerkhapering) zien allebei dezelfde stand. Zonder controle bij het
  // opslaan zou het laatste woord dan twee keer de puzzel afronden en twee
  // keer XP opleveren. Daarom slaat de update alleen op als de stand nog
  // dezelfde is; anders opnieuw lezen en opnieuw beoordelen.
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await tryFindWordSearchWord(userId, gameId, start, end);
    if (result !== "CONFLICT") return result;
  }
  const game = await prisma.wordSearchGame.findFirst({ where: { id: gameId, userId } });
  return game ? { correct: false, view: toView(game) } : null;
}

async function tryFindWordSearchWord(userId: string, gameId: string, start: WordSearchPosition, end: WordSearchPosition) {
  const game = await prisma.wordSearchGame.findFirst({ where: { id: gameId, userId } });
  if (!game || !(await canResumeGameContent(game.contentCollectionId))) return null;
  const grid = parseJson<string[][]>(game.grid, []);
  const words = parseJson<WordSearchPlacedWord[]>(game.words, []);
  const foundWords = parseJson<string[]>(game.foundWords, []);
  const match = selectionMatches(grid, words, start, end, game.difficulty === "HARD");
  // Een herhaald verzoek voor een al gevonden woord (ook als dat de puzzel
  // net afrondde) krijgt hetzelfde antwoord als het eerste, zonder XP.
  if (match && foundWords.includes(match.normalized)) return { correct: true, word: match.normalized, view: toView(game) };
  if (!match || game.status !== "IN_PROGRESS") return { correct: false, view: toView(game) };
  const nextFound = [...foundWords, match.normalized];
  const completed = nextFound.length === words.length;
  const updated = await prisma.$transaction(async (tx) => {
    const xpToday = await tx.wordSearchGame.count({
      where: {
        userId,
        status: "COMPLETED",
        xpEarned: { gt: 0 },
        finishedAt: { gte: new Date(`${dayKey()}T00:00:00.000Z`) },
      },
    });
    const xpEarned = completed && xpToday < 3 ? xpForDifficulty(game.difficulty) : 0;
    const saved = await tx.wordSearchGame.updateMany({
      where: { id: game.id, status: "IN_PROGRESS", foundWords: game.foundWords },
      data: {
        foundWords: JSON.stringify(nextFound),
        status: completed ? "COMPLETED" : "IN_PROGRESS",
        finishedAt: completed ? new Date() : null,
        xpEarned,
      },
    });
    if (saved.count === 0) return null;
    if (completed && xpEarned > 0) {
      await awardXp(tx, userId, xpEarned, "WORD_SEARCH_COMPLETED", { difficulty: game.difficulty, wordCount: words.length });
      await awardCompetitionXp(tx, userId, "WORD_SEARCH", xpEarned, {
        level: game.difficulty,
        won: true,
        metadata: { difficulty: game.difficulty, wordCount: words.length },
      });
    }
    return tx.wordSearchGame.findUniqueOrThrow({ where: { id: game.id } });
  });
  if (!updated) return "CONFLICT" as const;
  return { correct: true, word: match.normalized, view: toView(updated) };
}
