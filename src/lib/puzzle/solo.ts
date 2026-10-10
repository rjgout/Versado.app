import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { JigsawAnswerResult } from "@/lib/jigsaw";
import { prisma } from "@/lib/db";
import { jigsawCatalog } from "@/lib/jigsawGame";
import { jigsawQuestionById, jigsawQuestionLanguage, jigsawQuestionsForStory, JIGSAW_OPTION_COUNT } from "@/lib/jigsawQuestions";
import { completeJigsaw } from "@/lib/streak";
import { emitToUser } from "@/lib/realtime";
import { connectGroups, moveGroup, newPuzzleSnapshot, rotateGroup } from "@/lib/puzzle/engine";
import { areNeighbours, createPuzzleGeometry, pieceKind } from "@/lib/puzzle/geometry";
import { PUZZLE_DIFFICULTIES, PUZZLE_GEOMETRY_VERSION, PUZZLE_RULES_VERSION, SOLO_PIECE_COUNTS, type PuzzleDifficulty, type PuzzleHintType, type PuzzleSnapshot } from "@/lib/puzzle/types";

export const difficultySchema = z.enum(["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"]);
export const countSchema = z.union(SOLO_PIECE_COUNTS.map((count) => z.literal(count)) as [z.ZodLiteral<6>, z.ZodLiteral<12>, z.ZodLiteral<24>, z.ZodLiteral<48>, z.ZodLiteral<96>]);
const snapshotSchema = z.object({ version: z.number(), groups: z.array(z.object({ id: z.string(), pieceIds: z.array(z.number()), x: z.number(), y: z.number(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]) })), connections: z.array(z.object({ a: z.number(), b: z.number() })), hints: z.array(z.object({ type: z.enum(["PREVIEW", "LOCATION", "CONNECTION", "FILTER"]), at: z.string(), extra: z.boolean() })), filter: z.enum(["CORNERS", "EDGES", "MIDDLES"]).nullable(), completedAt: z.string().nullable() });

export type SoloAction = { kind: "move"; groupId: string; x: number; y: number } | { kind: "rotate"; groupId: string } | { kind: "connect"; a: number; b: number } | { kind: "hint"; hint: PuzzleHintType; pieceId?: number; filter?: "CORNERS" | "EDGES" | "MIDDLES" | null };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const seedFor = (contentKey: string) => hash(`puzzle-v${PUZZLE_GEOMETRY_VERSION}:${contentKey}`).slice(0, 32);

function optionOrder() { const result = [0, 1, 2]; for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result; }
export type SoloAnswer = JigsawAnswerResult | { alreadyAnswered: true };
const sessionInclude = { variant: { include: { definition: true } } } as const;
type Session = Prisma.PuzzleSessionGetPayload<{ include: typeof sessionInclude }>;

function publicState(row: Session, language: string | null | undefined) {
  const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot; const lang = jigsawQuestionLanguage(language);
  const question = row.questionId && row.optionOrder ? jigsawQuestionById(row.questionId) : undefined; const order = row.optionOrder ? JSON.parse(row.optionOrder) as number[] : [];
  return { id: row.id, version: row.version, status: row.status, image: row.variant.definition.imageUrl, story: row.variant.definition.storyNumber, seed: row.variant.definition.seed, geometryVersion: row.variant.definition.geometryVersion, pieceCount: row.variant.pieceCount, difficulty: row.variant.difficulty as PuzzleDifficulty, rulesVersion: row.variant.rulesVersion, snapshot, ...(question ? { question: { text: question.text[lang], options: order.map((index) => question.options[lang][index]) } } : {}), ...(row.status === "ANSWERED" ? { answer: row.answerResult ? JSON.parse(row.answerResult) as SoloAnswer : { alreadyAnswered: true } as const } : {}) };
}

async function lockSession(tx: Prisma.TransactionClient, userId: string, sessionId: string) {
  // Onder dezelfde lock lezen, valideren en schrijven, ook bij meerdere app-instances.
  await tx.$queryRaw`SELECT "id" FROM "PuzzleSession" WHERE "id" = ${sessionId} AND "ownerId" = ${userId} AND "mode" = 'SOLO' FOR UPDATE`;
  const row = await tx.puzzleSession.findFirst({ where: { id: sessionId, ownerId: userId, mode: "SOLO" }, include: sessionInclude });
  if (!row || row.status === "ANSWERED" || row.status === "ABANDONED") return row;
  const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot;
  const geometry = createPuzzleGeometry(row.variant.pieceCount as z.infer<typeof countSchema>, row.variant.definition.seed, row.variant.definition.geometryVersion);
  const group = snapshot.groups[0];
  const complete = snapshot.groups.length === 1 && group.rotation === 0 &&
    group.pieceIds.length === geometry.pieces.length && new Set(group.pieceIds).size === geometry.pieces.length &&
    group.pieceIds.every((id) => Number.isInteger(id) && id >= 0 && id < geometry.pieces.length) &&
    snapshot.connections.length === geometry.pieces.length - 1 &&
    new Set(snapshot.connections.map(({ a, b }) => [Math.min(a, b), Math.max(a, b)].join(":"))).size === snapshot.connections.length &&
    snapshot.connections.every(({ a, b }) => areNeighbours(geometry, a, b));
  // Verifieer ook de spanning tree: een timestamp alleen bewijst geen voltooiing.
  const reached = new Set([0]);
  for (let pass = 0; pass < geometry.pieces.length; pass++) for (const { a, b } of snapshot.connections) {
    if (reached.has(a)) reached.add(b);
    if (reached.has(b)) reached.add(a);
  }
  if (!complete || reached.size !== geometry.pieces.length) return row;
  if (row.status === "COMPLETED" && row.completedAt && row.questionId && row.optionOrder) return row;
  // Herstel reeds opgeslagen geometrische voltooiing uit de oude flow onder
  // dezelfde lock. Historische ANSWERED-sessies worden nooit herschreven.
  const completedAt = row.completedAt ?? (snapshot.completedAt ? new Date(snapshot.completedAt) : new Date());
  const choices = jigsawQuestionsForStory(row.variant.definition.storyNumber);
  const questionId = row.questionId ?? choices[randomInt(choices.length)].id;
  const version = row.version + 1;
  return tx.puzzleSession.update({ where: { id: row.id }, data: { status: "COMPLETED", completedAt, questionId, optionOrder: row.optionOrder ?? JSON.stringify(optionOrder()), version, snapshot: JSON.stringify({ ...snapshot, version, completedAt: completedAt.toISOString() }) }, include: sessionInclude });
}

async function definitionFor(content: number | string) {
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
    const existing = await tx.puzzleSession.findFirst({ where: { ownerId: userId, variantId: variant.id, status: { in: ["ACTIVE", "COMPLETED"] }, mode: "SOLO" }, orderBy: [{ status: "desc" }, { lastActivityAt: "desc" }, { id: "asc" }], include: sessionInclude });
    if (existing) return existing.id;
    const geometry = createPuzzleGeometry(pieceCount, definition.seed, definition.geometryVersion); const snapshot = newPuzzleSnapshot(geometry, difficulty);
    const session = await tx.puzzleSession.create({ data: { ownerId: userId, variantId: variant.id, snapshot: JSON.stringify(snapshot) }, include: sessionInclude });
    return session.id;
  });
  // De user-startlock is vrij voordat de sessielock wordt genomen. Antwoorden
  // nemen sessie→user-locks; zo ontstaat geen omgekeerde lockvolgorde.
  return (await resumeSoloPuzzle(userId, sessionId, language))!;
}

export async function resumeSoloPuzzle(userId: string, id: string, language: string | null | undefined) {
  return prisma.$transaction(async (tx) => {
    const row = await lockSession(tx, userId, id);
    return row ? publicState(row, language) : null;
  });
}

export async function applySoloAction(userId: string, sessionId: string, expectedVersion: number, actionId: string, action: SoloAction, language: string | null | undefined) {
  return prisma.$transaction(async (tx) => {
    const row = await lockSession(tx, userId, sessionId);
    if (!row) return null;
    const prior = await tx.puzzleAction.findUnique({ where: { sessionId_actionId: { sessionId, actionId } } });
    if (prior) return prior.payload === JSON.stringify(action) ? publicState(row, language) : null;
    if (row.status !== "ACTIVE" || row.version !== expectedVersion) return null;
    const snapshot = snapshotSchema.parse(JSON.parse(row.snapshot)) as PuzzleSnapshot; const difficulty = row.variant.difficulty as PuzzleDifficulty;
    const geometry = createPuzzleGeometry(row.variant.pieceCount as z.infer<typeof countSchema>, row.variant.definition.seed, row.variant.definition.geometryVersion);
    let next = snapshot; let hintTarget: unknown = undefined;
    if (action.kind === "move") next = moveGroup(snapshot, geometry, action.groupId, action.x, action.y);
    // Alleen Meester vraagt om rotatie. De route valideert dit ook server-side,
    // zodat een verborgen clientcontrol geen andere moeilijkheid kan veranderen.
    if (action.kind === "rotate" && difficulty === "MASTER") next = rotateGroup(snapshot, geometry, action.groupId);
    if (action.kind === "rotate" && difficulty !== "MASTER") return publicState(row, language);
    if (action.kind === "connect") next = connectGroups(snapshot, geometry, difficulty, action.a, action.b);
    if (action.kind === "hint") {
      const included = PUZZLE_DIFFICULTIES[difficulty].includedHints; const extra = included !== null && snapshot.hints.length >= included;
      next = { ...snapshot, filter: action.hint === "FILTER" ? action.filter ?? null : snapshot.filter, hints: [...snapshot.hints, { type: action.hint, at: new Date().toISOString(), extra }] };
      if (action.hint === "LOCATION" && action.pieceId !== undefined) { const piece = geometry.pieces[action.pieceId]; hintTarget = piece && { x: piece.column, y: piece.row }; }
      if (action.hint === "CONNECTION" && action.pieceId !== undefined) { const piece = geometry.pieces[action.pieceId]; hintTarget = piece && geometry.pieces.find((candidate) => Math.abs(candidate.column - piece.column) + Math.abs(candidate.row - piece.row) === 1)?.id; }
      if (action.hint === "FILTER") hintTarget = geometry.pieces.filter((piece) => !action.filter || pieceKind(piece) === action.filter).map((piece) => piece.id);
    }
    // Een mislukte verbindingspoging is een normale clientinteractie, geen
    // spelactie. Door hem niet op te slaan blijft de sessieversie stabiel als
    // de client de mogelijke naburen na een drop controleert.
    if (action.kind === "connect" && next === snapshot) return publicState(row, language);
    next = { ...next, version: row.version + 1 };
    const completed = next.completedAt && !row.completedAt ? new Date(next.completedAt) : row.completedAt;
    let questionId = row.questionId; let order = row.optionOrder;
    if (completed && !questionId) { const choices = jigsawQuestionsForStory(row.variant.definition.storyNumber); const chosen = choices[randomInt(choices.length)]; questionId = chosen?.id ?? null; order = questionId ? JSON.stringify(optionOrder()) : null; }
    await tx.puzzleAction.create({ data: { sessionId, actionId, type: action.kind, payload: JSON.stringify(action), version: row.version + 1 } });
    const updated = await tx.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify(next), version: { increment: 1 }, lastActivityAt: new Date(), completedAt: completed, status: completed ? "COMPLETED" : "ACTIVE", questionId, optionOrder: order }, include: sessionInclude });
    return { ...publicState(updated, language), ...(hintTarget !== undefined ? { hintTarget } : {}) };
  });
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
    const correct = order[choice] === 0; const outcome = await completeJigsaw(userId, `v2:${row.id}`, correct, tx);
    // Bij een claim uit een oudere, onderbroken afhandeling mag een nieuwe keuze
    // nooit het historische antwoord herschrijven of een nieuwe beloning maken.
    const answer: SoloAnswer = outcome.alreadyAnswered ? { alreadyAnswered: true } : { correct, correctChoice: order.indexOf(0), counted: outcome.counted, streak: outcome.result ? { currentStreak: outcome.result.currentStreak, dayEarned: outcome.result.dayEarned === true, alreadyStudiedToday: outcome.result.alreadyStudiedToday } : null };
    await tx.puzzleSession.update({ where: { id: row.id }, data: { status: "ANSWERED", answeredAt: new Date(), answerResult: JSON.stringify(answer), version: { increment: 1 }, lastActivityAt: new Date() } });
    if (!outcome.alreadyAnswered && correct && row.completedAt) { const hints = snapshotSchema.parse(JSON.parse(row.snapshot)).hints; const elapsedMs = Math.max(0, row.completedAt.getTime() - row.startedAt.getTime()); await tx.puzzlePersonalRecord.upsert({ where: { userId_variantId: { userId, variantId: row.variantId } }, create: { userId, variantId: row.variantId, sessionId: row.id, elapsedMs, hintsUsed: hints.length, extraHintsUsed: hints.filter((hint) => hint.extra).length, completedAt: row.completedAt }, update: {} }); }
    changed = !!outcome.result;
    return answer;
  });
  if (changed && result && "correct" in result && result.streak) emitToUser(userId, "streak_changed", { dayEarned: result.streak.dayEarned, currentStreak: result.streak.currentStreak });
  return result;
}
