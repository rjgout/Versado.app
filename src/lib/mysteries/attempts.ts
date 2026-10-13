import { createHash } from "node:crypto";
import type { MysteryAttempt, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getActiveGameCollection } from "@/lib/contentCollections";
import { getContentAvailability } from "@/lib/contentAccess";
import { checkGameAvailability } from "@/lib/gameAvailability";
import { recordLearningActivity } from "@/lib/streak";
import { emitToUser } from "@/lib/realtime";
import { MYSTERY_GAME } from "./game";
import { emptyMysteryPlacements } from "./mystery001a";
import { isSolutionCorrect, hintFor, sameCell } from "./logic";
import { firstCompletionUpdate } from "./progressRules";
import { characterCluesFor } from "./characterClues";
import { emptyClueNotes, validMysteryBoard, type MysteryAction, type MysteryAttemptView } from "./attemptContract";
import type { MysteryDefinition, MysteryDifficultyId, Placements } from "./types";

type Tx = Prisma.TransactionClient;
type HintUse = { actionId: string; hint: string; at: string };
export class MysteryAttemptError extends Error {
  constructor(public code: "NOT_FOUND" | "SOURCE_UNAVAILABLE" | "CONFLICT" | "INVALID" | "NO_HINTS", public current?: MysteryAttemptView) { super(code); }
}
export const mysteryDbDifficulty = (difficulty: MysteryDifficultyId) => difficulty === "discoverer" ? "DISCOVERER" as const : difficulty === "investigator" ? "INVESTIGATOR" as const : "SCRIPTURE_SCHOLAR" as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const mysteryDefinitionVersion = (definition: MysteryDefinition) => hash([definition, definition.characters.map(c => characterCluesFor(definition, c.id))]);
const definitionOf = (attempt: MysteryAttempt): MysteryDefinition | undefined => MYSTERY_GAME.puzzles.find(d => d.mysteryId === attempt.mysteryId && mysteryDbDifficulty(d.difficulty) === attempt.difficulty);
function hintUses(attempt: MysteryAttempt): HintUse[] { return attempt.hintUses as unknown as HintUse[]; }

async function attemptView(tx: Tx, attempt: MysteryAttempt): Promise<MysteryAttemptView> {
  const definition = definitionOf(attempt);
  const available = !!definition && attempt.definitionVersion === mysteryDefinitionVersion(definition)
    && await getContentAvailability({ isAdmin: false }, attempt.contentCollectionId, "read", tx);
  const chapter = available ? await tx.chapter.findFirst({ where: { number: definition!.story.source.chapterStart,
    book: { key: definition!.story.source.bookKey, contentCollectionId: attempt.contentCollectionId } }, select: { id: true } }) : null;
  return { id: attempt.id, revision: attempt.revision, status: attempt.status, available,
    // Bij ingetrokken toegang uitsluitend herstelbare metadata; geen bron of hintinhoud.
    placements: available ? attempt.placements as Placements : {},
    clueNotes: available ? attempt.clueNotes as Record<string, boolean> : {},
    hintCount: hintUses(attempt).length, hint: available ? hintUses(attempt).at(-1)?.hint ?? null : null,
    readerHref: chapter ? `/lesson/${chapter.id}` : null };
}
export async function getMysteryAttempt(userId: string, definition: MysteryDefinition) {
  return prisma.$transaction(async tx => {
    const attempt = await tx.mysteryAttempt.findFirst({ where: { userId, mysteryId: definition.mysteryId, difficulty: mysteryDbDifficulty(definition.difficulty), active: true } });
    return attempt ? attemptView(tx, attempt) : null;
  });
}
export async function hasMysteryAttempt(userId: string, number?: number): Promise<boolean> {
  return !!await prisma.mysteryAttempt.findFirst({ where: { userId, ...(number === undefined ? {} : { mysteryId: `mystery-${String(number).padStart(3, "0")}` }), active: true }, select: { id: true } });
}
async function lockOwner(tx: Tx, userId: string) {
  // Zelfde volgorde voor start/save/hint/completion: gebruiker → poging → voortgang.
  const owner = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  if (!owner.length) throw new MysteryAttemptError("NOT_FOUND");
}
export async function actOnMystery(userId: string, action: MysteryAction) {
  const result = await prisma.$transaction(async tx => {
    await lockOwner(tx, userId);
    if (action.action === "start") {
      const definition = MYSTERY_GAME.puzzles.find(d => d.routeId === action.variant);
      if (!definition) throw new MysteryAttemptError("INVALID");
      const where = { userId, mysteryId: definition.mysteryId, difficulty: mysteryDbDifficulty(definition.difficulty) };
      const retry = await tx.mysteryAttempt.findUnique({ where: { userId_startActionId: { userId, startActionId: action.actionId } } });
      if (retry) {
        if (retry.mysteryId !== definition.mysteryId || retry.difficulty !== where.difficulty) throw new MysteryAttemptError("INVALID");
        const current = await tx.mysteryAttempt.findFirst({ where: { ...where, active: true } });
        return { attempt: await attemptView(tx, current ?? retry) };
      }
      const current = await tx.mysteryAttempt.findFirst({ where: { ...where, active: true } });
      if (current && !action.restart) return { attempt: await attemptView(tx, current) };
      if (action.restart && (!current || current.id !== action.attemptId || current.revision !== action.expectedRevision))
        throw new MysteryAttemptError("CONFLICT", current ? await attemptView(tx, current) : undefined);
      const collection = await getActiveGameCollection(userId, tx);
      if (!collection || !(await checkGameAvailability("mystery", collection.id, 5, tx)).available) throw new MysteryAttemptError("SOURCE_UNAVAILABLE");
      if (definition.mysteryNumber > 1 && !await tx.mysteryProgress.findFirst({ where: { userId, mysteryId: `mystery-${String(definition.mysteryNumber - 1).padStart(3, "0")}`, completed: true } })) throw new MysteryAttemptError("SOURCE_UNAVAILABLE");
      const chapter = await tx.chapter.findFirst({ where: { number: definition.story.source.chapterStart, book: { key: definition.story.source.bookKey, contentCollectionId: collection.id } }, select: { id: true } });
      if (!chapter) throw new MysteryAttemptError("SOURCE_UNAVAILABLE");
      if (current) await tx.mysteryAttempt.update({ where: { id: current.id }, data: { active: false } });
      const created = await tx.mysteryAttempt.create({ data: { ...where, contentCollectionId: collection.id,
        definitionVersion: mysteryDefinitionVersion(definition), placements: JSON.parse(JSON.stringify(emptyMysteryPlacements(definition))), clueNotes: emptyClueNotes(definition), startActionId: action.actionId } });
      return { attempt: await attemptView(tx, created) };
    }
    const attempt = await tx.mysteryAttempt.findFirst({ where: { id: action.attemptId, userId } });
    if (!attempt) throw new MysteryAttemptError("NOT_FOUND");
    const definition = definitionOf(attempt);
    const current = await attemptView(tx, attempt);
    if (!current.available || !definition) throw new MysteryAttemptError("SOURCE_UNAVAILABLE");
    if (!attempt.active) throw new MysteryAttemptError("CONFLICT");
    const uses = hintUses(attempt);
    const paidRetry = uses.find(use => use.actionId === action.actionId);
    if (paidRetry) {
      if (action.action !== "hint") throw new MysteryAttemptError("INVALID");
      return { attempt: current, hint: paidRetry.hint, hintBalance: (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true } })).hintBalance };
    }
    const actionHash = `${action.actionId}:${hash(action)}`;
    if (attempt.lastActionId?.startsWith(`${action.actionId}:`)) {
      if (attempt.lastActionId !== actionHash) throw new MysteryAttemptError("INVALID");
      return { attempt: current, ...(action.action === "complete" ? { correct: true, firstCompletion: false } : {}) };
    }
    if (action.expectedRevision !== attempt.revision) throw new MysteryAttemptError("CONFLICT", current);
    if (attempt.status !== "IN_PROGRESS") {
      if (action.action === "complete") return { attempt: current, correct: true, firstCompletion: false };
      throw new MysteryAttemptError("CONFLICT", current);
    }
    const common = { revision: { increment: 1 }, lastActionId: actionHash };
    if (action.action === "save") {
      if (!validMysteryBoard(definition, { placements: action.placements, clueNotes: action.clueNotes })) throw new MysteryAttemptError("INVALID");
      const saved = await tx.mysteryAttempt.update({ where: { id: attempt.id }, data: { ...common, placements: action.placements, clueNotes: action.clueNotes } });
      if (definition.tutorial && sameCell(action.placements[definition.tutorial.characterId], definition.tutorial.cell)) {
        await tx.mysteryProgress.upsert({ where: { userId_mysteryId_difficulty: { userId, mysteryId: attempt.mysteryId, difficulty: attempt.difficulty } },
          create: { userId, mysteryId: attempt.mysteryId, difficulty: attempt.difficulty, tutorialSeenAt: new Date() }, update: {} });
        await tx.mysteryProgress.updateMany({ where: { userId, mysteryId: attempt.mysteryId, difficulty: attempt.difficulty, completed: false, tutorialSeenAt: null }, data: { tutorialSeenAt: new Date() } });
      }
      return { attempt: await attemptView(tx, saved) };
    }
    if (action.action === "hint") {
      const hint = hintFor(definition, attempt.placements as Placements);
      const debit = await tx.user.updateMany({ where: { id: userId, hintBalance: { gt: 0 } }, data: { hintBalance: { decrement: 1 } } });
      if (!debit.count) throw new MysteryAttemptError("NO_HINTS");
      const hintUse = { actionId: action.actionId, hint, at: new Date().toISOString() };
      const saved = await tx.mysteryAttempt.update({ where: { id: attempt.id }, data: { ...common, hintUses: [...uses, hintUse] } });
      return { attempt: await attemptView(tx, saved), hint, hintBalance: (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true } })).hintBalance };
    }
    if (!isSolutionCorrect(definition, attempt.placements as Placements)) return { attempt: current, correct: false, firstCompletion: false };
    const completedAt = new Date();
    const progressWhere = { userId, mysteryId: attempt.mysteryId, difficulty: attempt.difficulty };
    const progress = await tx.mysteryProgress.upsert({ where: { userId_mysteryId_difficulty: progressWhere }, create: progressWhere, update: {} });
    const update = firstCompletionUpdate(progress.completed, uses.length, completedAt);
    const saved = await tx.mysteryAttempt.update({ where: { id: attempt.id }, data: { ...common, status: "COMPLETED" } });
    let streakChanged = false;
    if (update) {
      await tx.mysteryProgress.update({ where: { id: progress.id }, data: update });
      const streak = await recordLearningActivity(tx, userId, { kind: "GAME", answered: 1, required: 1, key: `mystery:${definition.mysteryId}:${definition.difficulty}:first-completion` });
      streakChanged = streak.dayEarned;
    }
    return { attempt: await attemptView(tx, saved), correct: true, firstCompletion: !!update, streakChanged };
  }, { timeout: 10000 });
  if ("hintBalance" in result) emitToUser(userId, "hints_changed", {});
  if ("firstCompletion" in result && result.firstCompletion) emitToUser(userId, "streak_changed", { dayEarned: result.streakChanged });
  return result;
}
