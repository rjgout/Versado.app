import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { JigsawAnswerResult } from "@/lib/jigsaw";
import { prisma } from "@/lib/db";
import { jigsawCatalog } from "@/lib/jigsawGame";
import { jigsawQuestionById, jigsawQuestionLanguage, jigsawQuestionsForStory, JIGSAW_OPTION_COUNT } from "@/lib/jigsawQuestions";
import { completeJigsaw } from "@/lib/streak";
import { registerBestRecord } from "@/lib/puzzle/records";
import { emitToUser } from "@/lib/realtime";
import { anchorGroup, connectGroups, isPuzzleComplete, moveGroup, newPuzzleSnapshot, rotateGroup, validPuzzleStructure } from "@/lib/puzzle/engine";
import { createPuzzleGeometry } from "@/lib/puzzle/geometry";
import { puzzlePolicy, PUZZLE_HINT_DURATION_MS, PUZZLE_GEOMETRY_VERSION, PUZZLE_RULES_VERSION, SOLO_PIECE_COUNTS, type PuzzleDifficulty, type PuzzleHintType, type PuzzleSnapshot } from "@/lib/puzzle/types";

import { activePuzzleHint, puzzleHintTarget } from "@/lib/puzzle/hints";

export const difficultySchema = z.enum(["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"]);
export const countSchema = z.union(SOLO_PIECE_COUNTS.map((count) => z.literal(count)) as [z.ZodLiteral<6>, z.ZodLiteral<12>, z.ZodLiteral<24>, z.ZodLiteral<48>, z.ZodLiteral<96>]);
const hintTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PREVIEW") }),
  z.object({ type: z.literal("LOCATION"), groupId: z.string(), pieceIds: z.array(z.number()), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("CONNECTION"), groupId: z.string(), pieceId: z.number(), neighborId: z.number(), neighborGroupId: z.string() }),
  z.object({ type: z.literal("FILTER"), filter: z.enum(["CORNERS", "EDGES", "MIDDLES"]), pieceIds: z.array(z.number()) }),
]);
export const snapshotSchema = z.object({
  version: z.number(),
  groups: z.array(z.object({ id: z.string(), pieceIds: z.array(z.number()), x: z.number(), y: z.number(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), anchored: z.boolean().optional() })),
  connections: z.array(z.object({ a: z.number(), b: z.number() })),
  hints: z.array(z.object({ type: z.enum(["PREVIEW", "LOCATION", "CONNECTION", "FILTER"]), at: z.string(), extra: z.boolean(), source: z.enum(["INCLUDED", "PERSONAL"]).optional(), actionId: z.string().optional(), expiresAt: z.string().optional(), target: hintTargetSchema.optional() })),
  filter: z.enum(["CORNERS", "EDGES", "MIDDLES"]).nullable(), completedAt: z.string().nullable(),
});

export type SoloAction = { kind: "move"; groupId: string; x: number; y: number } | { kind: "rotate"; groupId: string } | { kind: "connect"; a: number; b: number } | { kind: "anchor"; groupId: string } | { kind: "hint"; hint: PuzzleHintType; confirmPersonal?: boolean; pieceId?: number; filter?: "CORNERS" | "EDGES" | "MIDDLES" | null };
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const seedFor = (contentKey: string) => hash(`puzzle-v${PUZZLE_GEOMETRY_VERSION}:${contentKey}`).slice(0, 32);

export function optionOrder() { const result = [0, 1, 2]; for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result; }
/** Uitkomst van de recordregistratie bij een goed beantwoorde Solo-puzzel (alleen informatief voor de resultaatkaart). */
export interface SoloRecordInfo { result: "CREATED" | "IMPROVED" | "UNCHANGED"; hintCategory: "NO_HINTS" | "WITH_HINTS"; elapsedMs: number; previousElapsedMs: number | null }
export type SoloAnswer = (JigsawAnswerResult & { record?: SoloRecordInfo }) | { alreadyAnswered: true };
export const sessionInclude = { variant: { include: { definition: true } } } as const;
export type Session = Prisma.PuzzleSessionGetPayload<{ include: typeof sessionInclude }>;

async function publicState(row: Session, language: string | null | undefined, tx: Prisma.TransactionClient) {
  const { hintBalance } = await tx.user.findUniqueOrThrow({ where: { id: row.ownerId }, select: { hintBalance: true } });
  const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot; const lang = jigsawQuestionLanguage(language);
  const question = row.questionId && row.optionOrder ? jigsawQuestionById(row.questionId) : undefined; const order = row.optionOrder ? JSON.parse(row.optionOrder) as number[] : [];
  return { hintBalance, id: row.id, version: row.version, status: row.status, image: row.variant.definition.imageUrl, story: row.variant.definition.storyNumber, seed: row.variant.definition.seed, geometryVersion: row.variant.definition.geometryVersion, pieceCount: row.variant.pieceCount, difficulty: row.variant.difficulty as PuzzleDifficulty, rulesVersion: row.variant.rulesVersion, snapshot, ...(question ? { question: { text: question.text[lang], options: order.map((index) => question.options[lang][index]) } } : {}), ...(row.status === "ANSWERED" ? { answer: row.answerResult ? JSON.parse(row.answerResult) as SoloAnswer : { alreadyAnswered: true } as const } : {}) };
}

export type EngineMode = "SOLO" | "MATCH";
/** Hooks voor een wedstrijd (mode MATCH): controle vóór en bijwerken ná een actie, in dezelfde transactie. */
export interface SessionHooks {
  /** Eerste handeling in de transactie, vóór de sessielock: voor een hogere lock (wedstrijd → sessie → gebruiker). */
  before?: (tx: Prisma.TransactionClient) => Promise<void>;
  guard?: (tx: Prisma.TransactionClient, row: Session) => Promise<void>;
  after?: (tx: Prisma.TransactionClient, row: Session, snapshot: PuzzleSnapshot) => Promise<void>;
}

export async function lockSession(tx: Prisma.TransactionClient, userId: string, sessionId: string, mode: EngineMode = "SOLO") {
  // Onder dezelfde lock lezen, valideren en schrijven, ook bij meerdere app-instances.
  await tx.$queryRaw`SELECT "id" FROM "PuzzleSession" WHERE "id" = ${sessionId} AND "ownerId" = ${userId} AND "mode" = ${mode}::"PuzzleSessionMode" FOR UPDATE`;
  const row = await tx.puzzleSession.findFirst({ where: { id: sessionId, ownerId: userId, mode }, include: sessionInclude });
  if (!row || row.status === "ANSWERED" || row.status === "ABANDONED") return row;
  const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot;
  const geometry = createPuzzleGeometry(row.variant.pieceCount as z.infer<typeof countSchema>, row.variant.definition.seed, row.variant.definition.geometryVersion);
  if (!isPuzzleComplete(snapshot, geometry, row.variant.difficulty as PuzzleDifficulty, row.variant.rulesVersion)) return row;
  if (row.status === "COMPLETED" && row.completedAt && row.questionId && row.optionOrder) return row;
  // Herstel reeds opgeslagen geometrische voltooiing uit de oude flow onder
  // dezelfde lock. Historische ANSWERED-sessies worden nooit herschreven.
  const completedAt = row.completedAt ?? (snapshot.completedAt ? new Date(snapshot.completedAt) : new Date());
  const choices = jigsawQuestionsForStory(row.variant.definition.storyNumber);
  const questionId = row.questionId ?? choices[randomInt(choices.length)].id;
  const version = row.version + 1;
  return tx.puzzleSession.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt, questionId, optionOrder: row.optionOrder ?? JSON.stringify(optionOrder()), version, snapshot: JSON.stringify({ ...snapshot, version, completedAt: completedAt.toISOString() }) }, include: sessionInclude });
}

export async function definitionFor(content: number | string) {
  const image = typeof content === "number" ? jigsawCatalog[content] : jigsawCatalog.find((item) => item.url === content); if (!image) throw new Error("Ongeldige puzzelafbeelding.");
  // Geometry v1-definities kunnen actieve of historische sessies hebben.
  // Een eigen v2-key houdt die sessies onveranderd leesbaar in plaats van
  // hun vorm stilzwijgend te vervangen.
  const contentKey = `kids:v${PUZZLE_GEOMETRY_VERSION}:${image.story}:${image.url}`; const seed = seedFor(contentKey);
  // Een lege-update-upsert kan via deze Prisma-driver een read→create-race
  // worden. ON CONFLICT bewaart één canonieke definitie, ook voor andere users.
  await prisma.puzzleDefinition.createMany({ data: [{ contentKey, imageUrl: image.url, storyNumber: image.story, aspectRatio: 1.5, geometryVersion: PUZZLE_GEOMETRY_VERSION, seed, definitionHash: hash(`${image.url}:${image.story}`) }], skipDuplicates: true });
  return prisma.puzzleDefinition.findUniqueOrThrow({ where: { contentKey } });
}

export async function startSoloPuzzle(userId: string, content: number | string, pieceCount: z.infer<typeof countSchema>, difficulty: PuzzleDifficulty, language: string | null | undefined) {
  const definition = await definitionFor(content);
  const variantKey = { definitionId: definition.id, pieceCount, difficulty, rulesVersion: PUZZLE_RULES_VERSION };
  await prisma.puzzleVariant.createMany({ data: [variantKey], skipDuplicates: true });
  const variant = await prisma.puzzleVariant.findUniqueOrThrow({ where: { definitionId_pieceCount_difficulty_rulesVersion: variantKey } });
  const sessionId = await prisma.$transaction(async (tx) => {
    // Dubbel klikken / twee apparaten mogen geen twee nieuwe actieve pogingen maken.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const existing = await tx.puzzleSession.findFirst({ where: { ownerId: userId, variant: { pieceCount, difficulty, rulesVersion: { in: [1, PUZZLE_RULES_VERSION] }, definition: { imageUrl: definition.imageUrl } }, status: { in: ["ACTIVE", "COMPLETED"] }, mode: "SOLO" }, orderBy: [{ status: "desc" }, { lastActivityAt: "desc" }, { id: "asc" }], include: sessionInclude });
    if (existing) return existing.id;
    const geometry = createPuzzleGeometry(pieceCount, definition.seed, definition.geometryVersion); const snapshot = newPuzzleSnapshot(geometry, difficulty);
    const session = await tx.puzzleSession.create({ data: { ownerId: userId, variantId: variant.id, snapshot: JSON.stringify(snapshot) }, include: sessionInclude });
    return session.id;
  });
  // De user-startlock is vrij voordat de sessielock wordt genomen. Antwoorden
  // nemen sessie→user-locks; zo ontstaat geen omgekeerde lockvolgorde.
  return (await resumeSoloPuzzle(userId, sessionId, language))!;
}

export async function resumeSoloPuzzle(userId: string, id: string, language: string | null | undefined, mode: EngineMode = "SOLO") {
  return prisma.$transaction(async (tx) => {
    const row = await lockSession(tx, userId, id, mode);
    return row ? publicState(row, language, tx) : null;
  });
}

export class PuzzleHintError extends Error {
  constructor(readonly code: "EMPTY" | "CONFIRM", readonly hintBalance: number) { super(code); }
}

export async function applySoloAction(userId: string, sessionId: string, expectedVersion: number, actionId: string, action: SoloAction, language: string | null | undefined, mode: EngineMode = "SOLO", hooks: SessionHooks = {}) {
  let inventoryChanged = false;
  const result = await prisma.$transaction(async (tx) => {
    if (hooks.before) await hooks.before(tx);
    const row = await lockSession(tx, userId, sessionId, mode);
    if (!row) return null;
    if (hooks.guard) await hooks.guard(tx, row);
    const prior = await tx.puzzleAction.findUnique({ where: { sessionId_actionId: { sessionId, actionId } } });
    if (prior) return prior.payload === JSON.stringify(action) ? publicState(row, language, tx) : null;
    if (row.status !== "ACTIVE" || row.version !== expectedVersion) return null;
    const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot; const difficulty = row.variant.difficulty as PuzzleDifficulty;
    const geometry = createPuzzleGeometry(row.variant.pieceCount as z.infer<typeof countSchema>, row.variant.definition.seed, row.variant.definition.geometryVersion);
    if (!validPuzzleStructure(snapshot, geometry, difficulty, row.variant.rulesVersion)) return null;
    let next = snapshot;
    if (action.kind === "move") next = moveGroup(snapshot, geometry, action.groupId, action.x, action.y);
    // Alleen Meester vraagt om rotatie. De route valideert dit ook server-side,
    // zodat een verborgen clientcontrol geen andere moeilijkheid kan veranderen.
    if (action.kind === "rotate" && difficulty === "MASTER") next = rotateGroup(snapshot, geometry, action.groupId);
    if (action.kind === "rotate" && difficulty !== "MASTER") return publicState(row, language, tx);
    if (action.kind === "connect") next = connectGroups(snapshot, geometry, difficulty, action.a, action.b, row.variant.rulesVersion);
    if (action.kind === "anchor") next = anchorGroup(snapshot, geometry, difficulty, action.groupId, row.variant.rulesVersion);
    if (action.kind === "hint") {
      // Een lopende hint beschermt ook tegen snelle herhaalde klikken met
      // verschillende actionIds. Herladen gebruikt dezelfde absolute eindtijd.
      if (activePuzzleHint(snapshot)) return publicState(row, language, tx);
      const target = puzzleHintTarget(snapshot, geometry, action.hint, action.pieceId, action.filter);
      if (!target || (target.type === "FILTER" && !target.pieceIds.length)) return publicState(row, language, tx);
      const included = puzzlePolicy(difficulty, row.variant.rulesVersion).includedHints;
      const now = new Date(); const extra = included !== null && snapshot.hints.length >= included;
      if (extra) {
        // Dezelfde lockvolgorde als antwoorden: sessie → gebruiker. De startlock
        // is al vrij. UPDATE ... WHERE balance > 0 beschermt alle hintactiviteiten.
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true } });
        if (user.hintBalance <= 0) throw new PuzzleHintError("EMPTY", user.hintBalance);
        if (!action.confirmPersonal) throw new PuzzleHintError("CONFIRM", user.hintBalance);
        const consumed = await tx.user.updateMany({ where: { id: userId, hintBalance: { gt: 0 } }, data: { hintBalance: { decrement: 1 } } });
        if (consumed.count !== 1) throw new PuzzleHintError("EMPTY", 0);
        inventoryChanged = true;
      }
      next = { ...snapshot, hints: [...snapshot.hints, { source: extra ? "PERSONAL" : "INCLUDED", type: action.hint, at: now.toISOString(), extra, actionId, expiresAt: new Date(now.getTime() + PUZZLE_HINT_DURATION_MS).toISOString(), target }] };
    }
    // Ongeldige plaatsing/verbinding of verplaatsing van een bordanker is
    // geen actie: geen versieophoging, logrecord of verandering van voortgang.
    if (next === snapshot) return publicState(row, language, tx);
    next = { ...next, version: row.version + 1 };
    const completed = isPuzzleComplete(next, geometry, difficulty, row.variant.rulesVersion) ? row.completedAt ?? new Date(next.completedAt ?? Date.now()) : null;
    next.completedAt = completed?.toISOString() ?? null;
    let questionId = row.questionId; let order = row.optionOrder;
    if (completed && !questionId) { const choices = jigsawQuestionsForStory(row.variant.definition.storyNumber); const chosen = choices[randomInt(choices.length)]; questionId = chosen?.id ?? null; order = questionId ? JSON.stringify(optionOrder()) : null; }
    await tx.puzzleAction.create({ data: { sessionId, actionId, type: action.kind, payload: JSON.stringify(action), version: row.version + 1 } });
    const updated = await tx.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify(next), version: { increment: 1 }, lastActivityAt: new Date(), completedAt: completed, status: completed ? "COMPLETED" : "ACTIVE", questionId, optionOrder: order }, include: sessionInclude });
    await hooks.after?.(tx, updated, next);
    return publicState(updated, language, tx);
  });
  // Pas na commit; een retry van dezelfde actionId zendt geen nieuw verbruik.
  if (inventoryChanged) emitToUser(userId, "hints_changed");
  return result;
}

export async function answerSoloPuzzle(userId: string, sessionId: string, choice: number): Promise<SoloAnswer | null> {
  let changed = false;
  const result = await prisma.$transaction(async (tx): Promise<SoloAnswer | null> => {
    const row = await lockSession(tx, userId, sessionId);
    if (!row || (row.status !== "COMPLETED" && row.status !== "ANSWERED") || !row.questionId || !row.optionOrder) return null;
    const order = JSON.parse(row.optionOrder) as number[]; if (!Number.isInteger(choice) || choice < 0 || choice >= JIGSAW_OPTION_COUNT) return null;
    // Een eerder verstuurde keuze mag een sessie nooit in de voltooiingsstap
    // laten hangen. De activiteitclaim blijft centraal en idempotent.
    if (row.status === "ANSWERED") return row.answerResult ? JSON.parse(row.answerResult) as SoloAnswer : { alreadyAnswered: true };
    const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot;
    const geometry = createPuzzleGeometry(row.variant.pieceCount as z.infer<typeof countSchema>, row.variant.definition.seed, row.variant.definition.geometryVersion);
    if (!isPuzzleComplete(snapshot, geometry, row.variant.difficulty as PuzzleDifficulty, row.variant.rulesVersion)) return null;
    const correct = order[choice] === 0; const outcome = await completeJigsaw(userId, `v2:${row.id}`, correct, tx);
    // Het persoonlijke beste record (fase 4): alleen een geldige prestatie, dus een goed beantwoorde vraag op een
    // geometrisch voltooide puzzel, en nooit bij een herhaald antwoord. De puzzeltijd is completedAt - startedAt; de
    // tijd die aan de vraag besteed wordt telt niet mee. Dezelfde transactie als de beloning, zodat een retry niets dubbel doet.
    let record: SoloRecordInfo | undefined;
    if (!outcome.alreadyAnswered && correct && row.completedAt) {
      const hints = snapshotSchema.parse(JSON.parse(row.snapshot)).hints; const elapsedMs = Math.max(0, row.completedAt.getTime() - row.startedAt.getTime());
      const extraHintsUsed = hints.filter((hint) => hint.extra).length;
      // Het historische "eerste geldige prestatie"-register blijft ongewijzigd bijgehouden.
      await tx.puzzlePersonalRecord.upsert({ where: { userId_variantId: { userId, variantId: row.variantId } }, create: { userId, variantId: row.variantId, sessionId: row.id, elapsedMs, hintsUsed: hints.length, extraHintsUsed, completedAt: row.completedAt }, update: {} });
      const registered = await registerBestRecord(tx, { userId, variantId: row.variantId, mode: "SOLO", elapsedMs, hintsUsed: hints.length, extraHintsUsed, completedAt: row.completedAt, sessionId: row.id });
      record = { result: registered.result, hintCategory: registered.hintCategory, elapsedMs: registered.elapsedMs, previousElapsedMs: registered.previousElapsedMs };
    }
    // Bij een claim uit een oudere, onderbroken afhandeling mag een nieuwe keuze
    // nooit het historische antwoord herschrijven of een nieuwe beloning maken.
    const answer: SoloAnswer = outcome.alreadyAnswered ? { alreadyAnswered: true } : { correct, correctChoice: order.indexOf(0), counted: outcome.counted, streak: outcome.result ? { currentStreak: outcome.result.currentStreak, dayEarned: outcome.result.dayEarned === true, alreadyStudiedToday: outcome.result.alreadyStudiedToday } : null, ...(record ? { record } : {}) };
    await tx.puzzleSession.update({ where: { id: row.id }, data: { status: "ANSWERED", answeredAt: new Date(), answerResult: JSON.stringify(answer), version: { increment: 1 }, lastActivityAt: new Date() } });
    changed = !!outcome.result;
    return answer;
  });
  if (changed && result && "correct" in result && result.streak) emitToUser(userId, "streak_changed", { dayEarned: result.streak.dayEarned, currentStreak: result.streak.currentStreak });
  return result;
}
