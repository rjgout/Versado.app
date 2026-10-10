import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { jigsawCatalog } from "@/lib/jigsawGame";
import { jigsawQuestionById, jigsawQuestionLanguage, jigsawQuestionsForStory, JIGSAW_OPTION_COUNT } from "@/lib/jigsawQuestions";
import { completeJigsaw } from "@/lib/streak";
import { connectGroups, moveGroup, newPuzzleSnapshot, rotateGroup } from "@/lib/puzzle/engine";
import { createPuzzleGeometry, pieceKind } from "@/lib/puzzle/geometry";
import { PUZZLE_DIFFICULTIES, PUZZLE_GEOMETRY_VERSION, PUZZLE_RULES_VERSION, SOLO_PIECE_COUNTS, type PuzzleDifficulty, type PuzzleHintType, type PuzzleSnapshot } from "@/lib/puzzle/types";

export const difficultySchema = z.enum(["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"]);
export const countSchema = z.union(SOLO_PIECE_COUNTS.map((count) => z.literal(count)) as [z.ZodLiteral<6>, z.ZodLiteral<12>, z.ZodLiteral<24>, z.ZodLiteral<48>, z.ZodLiteral<96>]);
const snapshotSchema = z.object({ version: z.number(), groups: z.array(z.object({ id: z.string(), pieceIds: z.array(z.number()), x: z.number(), y: z.number(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) })), connections: z.array(z.object({ a: z.number(), b: z.number() })), hints: z.array(z.object({ type: z.enum(["PREVIEW", "LOCATION", "CONNECTION", "FILTER"]), at: z.string(), extra: z.boolean() })), filter: z.enum(["CORNERS", "EDGES", "MIDDLES"]).nullable(), completedAt: z.string().nullable() });

export type SoloAction = { kind: "move"; groupId: string; x: number; y: number } | { kind: "rotate"; groupId: string } | { kind: "connect"; a: number; b: number } | { kind: "hint"; hint: PuzzleHintType; pieceId?: number; filter?: "CORNERS" | "EDGES" | "MIDDLES" | null };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const seedFor = (contentKey: string) => hash(`puzzle-v${PUZZLE_GEOMETRY_VERSION}:${contentKey}`).slice(0, 32);

function optionOrder() { const result = [0, 1, 2]; for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result; }
function publicState(row: { id: string; version: number; status: string; snapshot: string; variant: { pieceCount: number; difficulty: string; rulesVersion: number; definition: { imageUrl: string; storyNumber: number; seed: string; geometryVersion: number } }; questionId: string | null; optionOrder: string | null }, language: string | null | undefined) {
  const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot; const lang = jigsawQuestionLanguage(language);
  const question = row.questionId && row.optionOrder ? jigsawQuestionById(row.questionId) : undefined; const order = row.optionOrder ? JSON.parse(row.optionOrder) as number[] : [];
  return { id: row.id, version: row.version, status: row.status, image: row.variant.definition.imageUrl, story: row.variant.definition.storyNumber, seed: row.variant.definition.seed, geometryVersion: row.variant.definition.geometryVersion, pieceCount: row.variant.pieceCount, difficulty: row.variant.difficulty as PuzzleDifficulty, rulesVersion: row.variant.rulesVersion, snapshot, ...(question ? { question: { text: question.text[lang], options: order.map((index) => question.options[lang][index]) } } : {}) };
}

async function definitionFor(imageIndex: number) {
  const image = jigsawCatalog[imageIndex]; if (!image) throw new Error("Ongeldige puzzelafbeelding.");
  const contentKey = `kids:${image.story}:${image.url}`; const seed = seedFor(contentKey);
  return prisma.puzzleDefinition.upsert({ where: { contentKey }, create: { contentKey, imageUrl: image.url, storyNumber: image.story, aspectRatio: 1.5, geometryVersion: PUZZLE_GEOMETRY_VERSION, seed, definitionHash: hash(`${image.url}:${image.story}`) }, update: {} });
}

export async function startSoloPuzzle(userId: string, imageIndex: number, pieceCount: z.infer<typeof countSchema>, difficulty: PuzzleDifficulty, language: string | null | undefined) {
  const definition = await definitionFor(imageIndex);
  const variant = await prisma.puzzleVariant.upsert({ where: { definitionId_pieceCount_difficulty_rulesVersion: { definitionId: definition.id, pieceCount, difficulty, rulesVersion: PUZZLE_RULES_VERSION } }, create: { definitionId: definition.id, pieceCount, difficulty, rulesVersion: PUZZLE_RULES_VERSION }, update: {} });
  const existing = await prisma.puzzleSession.findFirst({ where: { ownerId: userId, variantId: variant.id, status: "ACTIVE", mode: "SOLO" }, orderBy: { lastActivityAt: "desc" }, include: { variant: { include: { definition: true } } } });
  if (existing) return publicState(existing, language);
  const geometry = createPuzzleGeometry(pieceCount, definition.seed, definition.geometryVersion); const snapshot = newPuzzleSnapshot(geometry, difficulty);
  const session = await prisma.puzzleSession.create({ data: { ownerId: userId, variantId: variant.id, snapshot: JSON.stringify(snapshot) }, include: { variant: { include: { definition: true } } } });
  return publicState(session, language);
}

export async function resumeSoloPuzzle(userId: string, id: string, language: string | null | undefined) {
  const row = await prisma.puzzleSession.findFirst({ where: { id, ownerId: userId, mode: "SOLO" }, include: { variant: { include: { definition: true } } } });
  return row ? publicState(row, language) : null;
}

export async function applySoloAction(userId: string, sessionId: string, expectedVersion: number, actionId: string, action: SoloAction, language: string | null | undefined) {
  const row = await prisma.puzzleSession.findFirst({ where: { id: sessionId, ownerId: userId, mode: "SOLO" }, include: { variant: { include: { definition: true } } } });
  if (!row || row.status !== "ACTIVE" || row.version !== expectedVersion) return null;
  const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot; const difficulty = row.variant.difficulty as PuzzleDifficulty;
  const geometry = createPuzzleGeometry(row.variant.pieceCount as z.infer<typeof countSchema>, row.variant.definition.seed, row.variant.definition.geometryVersion);
  let next = snapshot; let hintTarget: unknown = undefined;
  if (action.kind === "move") next = moveGroup(snapshot, action.groupId, action.x, action.y);
  if (action.kind === "rotate") next = rotateGroup(snapshot, action.groupId);
  if (action.kind === "connect") next = connectGroups(snapshot, geometry, difficulty, action.a, action.b);
  if (action.kind === "hint") {
    const included = PUZZLE_DIFFICULTIES[difficulty].includedHints; const extra = included !== null && snapshot.hints.length >= included;
    next = { ...snapshot, filter: action.hint === "FILTER" ? action.filter ?? null : snapshot.filter, hints: [...snapshot.hints, { type: action.hint, at: new Date().toISOString(), extra }] };
    if (action.hint === "LOCATION" && action.pieceId !== undefined) { const piece = geometry.pieces[action.pieceId]; hintTarget = piece && { x: piece.column, y: piece.row }; }
    if (action.hint === "CONNECTION" && action.pieceId !== undefined) { const piece = geometry.pieces[action.pieceId]; hintTarget = piece && geometry.pieces.find((candidate) => Math.abs(candidate.column - piece.column) + Math.abs(candidate.row - piece.row) === 1)?.id; }
    if (action.hint === "FILTER") hintTarget = geometry.pieces.filter((piece) => !action.filter || pieceKind(piece) === action.filter).map((piece) => piece.id);
  }
  const completed = next.completedAt && !row.completedAt ? new Date(next.completedAt) : row.completedAt;
  let questionId = row.questionId; let order = row.optionOrder;
  if (completed && !questionId) { const choices = jigsawQuestionsForStory(row.variant.definition.storyNumber); const chosen = choices[randomInt(choices.length)]; questionId = chosen?.id ?? null; order = questionId ? JSON.stringify(optionOrder()) : null; }
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.puzzleAction.create({ data: { sessionId, actionId, type: action.kind, payload: JSON.stringify(action), version: row.version + 1 } }).catch(() => null);
    if (!claimed) return null;
    return tx.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify(next), version: { increment: 1 }, lastActivityAt: new Date(), completedAt: completed, status: completed ? "COMPLETED" : "ACTIVE", questionId, optionOrder: order }, include: { variant: { include: { definition: true } } } });
  });
  return updated ? { ...publicState(updated, language), hintTarget } : null;
}

export async function answerSoloPuzzle(userId: string, sessionId: string, choice: number) {
  const row = await prisma.puzzleSession.findFirst({ where: { id: sessionId, ownerId: userId, mode: "SOLO" }, include: { variant: { include: { definition: true } } } });
  if (!row || row.status !== "COMPLETED" || !row.questionId || !row.optionOrder) return null;
  const order = JSON.parse(row.optionOrder) as number[]; if (!Number.isInteger(choice) || choice < 0 || choice >= JIGSAW_OPTION_COUNT) return null;
  const correct = order[choice] === 0; const outcome = await completeJigsaw(userId, `v2:${row.id}`, correct);
  if (outcome.alreadyAnswered) return { alreadyAnswered: true };
  await prisma.puzzleSession.update({ where: { id: row.id }, data: { status: "ANSWERED", answeredAt: new Date() } });
  if (correct && row.completedAt) { const hints = snapshotSchema.parse(JSON.parse(row.snapshot)).hints; const elapsedMs = Math.max(0, row.completedAt.getTime() - row.startedAt.getTime()); await prisma.puzzlePersonalRecord.upsert({ where: { userId_variantId: { userId, variantId: row.variantId } }, create: { userId, variantId: row.variantId, sessionId: row.id, elapsedMs, hintsUsed: hints.length, extraHintsUsed: hints.filter((hint) => hint.extra).length, completedAt: row.completedAt }, update: {} }); }
  return { alreadyAnswered: false, correct, correctChoice: order.indexOf(0), counted: outcome.counted, streak: outcome.result ? { currentStreak: outcome.result.currentStreak, dayEarned: outcome.result.dayEarned === true, alreadyStudiedToday: outcome.result.alreadyStudiedToday } : null };
}
