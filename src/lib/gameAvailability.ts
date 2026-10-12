import { prisma } from "@/lib/db";
import { collectionAccessWhere } from "@/lib/contentAccess";
import { getActiveGameCollection } from "@/lib/contentCollections";
import type { Prisma } from "@/generated/prisma/client";
import { parseItem } from "@/lib/alleskenner/validate";
import { MYSTERY_GAME } from "@/lib/mysteries/game";
import { jigsawQuestionsForStory } from "@/lib/jigsawQuestions";
import { getGameSettings } from "@/lib/gameSettings";
import { GAME_SCOPE_KEYS, fixedLiveGameCollectionId, gameSettingEnabled, supportsGameSource, type ScopedGame } from "@/lib/gameAvailabilityPolicy";
import bomWords from "../../prisma/bomWords.json";
import kidsManifest from "../../prisma/kidsManifest.json";
import { getWordSearchCandidates } from "@/lib/wordSearch/content";
import { WORD_SEARCH_CONFIG } from "@/lib/wordSearch/generator";

export type GameAvailability = { available: boolean; reason?: "content" | "unsupported" | "disabled" | "scope" | "pool"; collectionId?: string };

type AvailableCollection = Prisma.ContentCollectionGetPayload<{ include: { contentWork: true } }>;

/** Alleen binnen één aanroep delen; rechten/settings/scopes worden nooit langdurig gecachet. */
function availabilityRequest(collectionId: string, validatedCollection?: AvailableCollection) {
  let collection: Promise<AvailableCollection | null> | undefined;
  let settings: ReturnType<typeof getGameSettings> | undefined;
  let scopes: Promise<Set<string>> | undefined;
  let fixed: Promise<boolean> | undefined;
  let chapters: Promise<number> | undefined;
  let exercises: Promise<number> | undefined;
  return {
    collection: () => collection ??= validatedCollection ? Promise.resolve(validatedCollection) : prisma.contentCollection.findFirst({ where: { id: collectionId, ...collectionAccessWhere({ isAdmin: false }) }, include: { contentWork: true } }),
    settings: () => settings ??= getGameSettings(),
    scopes: () => scopes ??= prisma.gameContentScope.findMany({ where: { contentCollectionId: collectionId }, select: { gameKey: true } }).then(rows => new Set(rows.map(row => row.gameKey))),
    fixedSource: () => fixed ??= collectionId === "content_bom" ? Promise.resolve(true) : prisma.contentCollection.findFirst({ where: { id: "content_bom", ...collectionAccessWhere({ isAdmin: false }) }, select: { id: true } }).then(Boolean),
    chapters: () => chapters ??= prisma.chapter.count({ where: { book: { contentCollectionId: "content_bom" }, OR: [{ heading: { not: "" } }, { verses: { some: {} } }] } }),
    exercises: () => exercises ??= prisma.exercise.count({ where: { status: "APPROVED", chapter: { book: { contentCollectionId: collectionId } } } }),
  };
}

/** Deze fase controleert bestaande pools; geen nieuwe spelresolver of writer. */
async function checkInRequest(game: ScopedGame, collectionId: string, requiredChapters: number, dependencies: ReturnType<typeof availabilityRequest>): Promise<GameAvailability> {
  const collection = await dependencies.collection();
  if (!collection) return { available: false, reason: "content" };
  if (!supportsGameSource(game, { ...collection, kind: collection.contentWork?.kind ?? null })) return { available: false, reason: "unsupported" };
  if (!gameSettingEnabled(game, await dependencies.settings())) return { available: false, reason: "disabled" };
  if (!(await dependencies.scopes()).has(game)) return { available: false, reason: "scope" };
  let enough = false;
  if (game === "word-search") {
    const candidates = await getWordSearchCandidates(collectionId, collection.language);
    enough = Object.values(WORD_SEARCH_CONFIG).every(config => candidates.filter(c => c.normalized.length >= config.minLength && c.normalized.length <= config.maxLength).length >= config.wordCount);
  } else if (game === "live-exercises" || game === "challenges") {
    enough = await dependencies.exercises() > 0;
  } else {
    // Deze bestaande spellen gebruiken expliciet vaste Nederlandse BOM-content,
    // ook wanneer de UI of gekozen BOM-uitgave een andere taal heeft.
    const fixed = await dependencies.fixedSource();
    if (!fixed) return { available: false, reason: "content" };
    if (game === "word-game") enough = (bomWords as string[]).filter(w => /^[a-z]{5}$/.test(w)).length > 0;
    else if (game === "scrabble") enough = (bomWords as string[]).some(w => /^[a-z]{2,7}$/.test(w));
    else if (game === "jigsaw") enough = kidsManifest.some(story => story.images.length > 0 && jigsawQuestionsForStory(story.number).length > 0);
    else if (game === "chapter-guess" || game === "gezinsavond") {
      const chapters = await dependencies.chapters();
      enough = chapters >= (game === "chapter-guess" ? requiredChapters : 4);
      if (game === "gezinsavond") {
        const groups = await prisma.exercise.groupBy({ by: ["type"], where: { status: "APPROVED", chapter: { book: { contentCollectionId: "content_bom" } } }, _count: true });
        enough = enough && ["TRUE_FALSE", "FILL_BLANK", "WORD_BANK"].every(type => groups.some(g => g.type === type && g._count > 0));
      }
    } else if (game === "alleskenner") {
      const rows = await prisma.alleskennerItem.findMany({ where: { enabled: true, ...(collection.language !== "nl" ? { editedByAdmin: false, translations: { some: { language: collection.language } } } : {}) }, select: { id: true, kind: true, data: true, translations: { where: { language: collection.language }, select: { data: true } } } });
      const valid = rows.flatMap(row => {
        try { const item = parseItem(row.id, row.kind, JSON.parse(collection.language === "nl" ? row.data : row.translations[0]?.data ?? "null")); return typeof item === "string" ? [] : [item]; } catch { return []; }
      });
      enough = valid.filter(item => item.kind === "QUESTION" && !item.data.listen).length >= 9
        && valid.filter(item => item.kind === "TOPIC" && item.data.answers.length >= 4).length >= 3
        && ["PUZZLE", "GALLERY", "MEMORY"].every(kind => valid.some(item => item.kind === kind));
    }
    // Mysterie en de arcade gebruiken meegeleverde, vaste puzzels/levels.
    else enough = game === "mystery" ? MYSTERY_GAME.puzzles.length > 0 : game === "quick-missionary";
  }
  return enough ? { available: true, collectionId } : { available: false, reason: "pool" };
}

export async function checkGameAvailability(game: ScopedGame, collectionId: string, requiredChapters = 5): Promise<GameAvailability> {
  return checkInRequest(game, collectionId, requiredChapters, availabilityRequest(collectionId));
}

export async function availableGameKeys(collectionId: string): Promise<string[]> {
  const dependencies = availabilityRequest(collectionId);
  const scopes = await dependencies.scopes();
  const known = [...scopes].filter(key => (GAME_SCOPE_KEYS as readonly string[]).includes(key));
  const results = await Promise.all(known.map(async key => ({ key, result: await checkInRequest(key as ScopedGame, collectionId, 5, dependencies) })));
  return results.filter(r => r.result.available).map(r => r.key);
}

/** Actuele voorkeur wordt alleen voor nieuwe starts gebruikt, nooit voor hervatten. */
export async function canStartGame(userId: string, game: ScopedGame, requiredChapters = 5): Promise<boolean> {
  const collection = await getActiveGameCollection(userId);
  if (!collection) return false;
  return (await checkInRequest(game, collection.id, requiredChapters, availabilityRequest(collection.id, collection))).available;
}

/** Vastgelegde bronrechten, zonder nieuwe settings/scope of huidige bronvoorkeur. */
export async function canResumeGameContent(collectionId: string | null): Promise<boolean> {
  return Boolean(collectionId && await prisma.contentCollection.findFirst({ where: { id: collectionId, ...collectionAccessWhere({ isAdmin: false }) }, select: { id: true } }));
}

/** Bestaande realtimepartijen: opgeslagen hoofdstuk/cursus of bewezen vaste BOM-pool. */
export async function canResumeLiveGame(code: string): Promise<boolean> {
  const game = await prisma.liveGame.findUnique({ where: { code }, select: {
    mode: true, chapter: { select: { book: { select: { contentCollectionId: true } } } },
    studySession: { select: { course: { select: { contentCollectionId: true } } } },
  } });
  if (!game) return false;
  const collectionId = game.mode === "STUDY" ? game.studySession?.course.contentCollectionId
    : game.mode === "EXERCISES" ? game.chapter?.book.contentCollectionId
    : fixedLiveGameCollectionId(game.mode);
  return canResumeGameContent(collectionId ?? null);
}
