import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Persoonlijke beste tijden en vriendenranglijsten van Legpuzzel 2.0 (fase 4).
//
// Sleutel: gebruiker + exacte puzzelvariant (afbeelding/geometrie, aantal stukken, moeilijkheid, spelregelversie)
// + modus (SOLO/MATCH) + hintcategorie (NO_HINTS/WITH_HINTS). Samen heeft bewust geen snelheidsrecord.
// Een hint — ook een gratis inbegrepen hint — telt als hintgebruik.
//
// Geen next/headers: dit bestand wordt ook geladen via de servicelaag van de puzzel.

type Tx = Prisma.TransactionClient;
export type RecordMode = "SOLO" | "MATCH";
export type HintCategory = "NO_HINTS" | "WITH_HINTS";
export const RECORD_MODES: readonly RecordMode[] = ["SOLO", "MATCH"];
export const HINT_CATEGORIES: readonly HintCategory[] = ["NO_HINTS", "WITH_HINTS"];
export const LEADERBOARD_LIMIT = 50;

export const hintCategoryFor = (hintsUsed: number): HintCategory => (hintsUsed > 0 ? "WITH_HINTS" : "NO_HINTS");

export interface RecordCandidate {
  userId: string; variantId: string; mode: RecordMode;
  elapsedMs: number; hintsUsed: number; extraHintsUsed: number; completedAt: Date;
  sessionId: string; matchParticipantId?: string | null;
}

interface Comparable { elapsedMs: number; extraHintsUsed: number; hintsUsed: number; completedAt: Date; userId?: string; sessionId?: string }

/**
 * Eén deterministische volgorde voor ranglijsten én voor het vervangen van een persoonlijk record:
 * laagste tijd (in milliseconden), dan minste persoonlijke extra hints, dan minste hints in totaal, dan de
 * vroegste voltooiing, tot slot een stabiele sleutel. Negatief = a staat vóór b.
 */
export function compareRecords(a: Comparable, b: Comparable): number {
  return (a.elapsedMs - b.elapsedMs) || (a.extraHintsUsed - b.extraHintsUsed) || (a.hintsUsed - b.hintsUsed)
    || (a.completedAt.getTime() - b.completedAt.getTime()) || (a.userId ?? "").localeCompare(b.userId ?? "") || (a.sessionId ?? "").localeCompare(b.sessionId ?? "");
}

export interface RegisterOutcome {
  /** CREATED: eerste record in deze categorie; IMPROVED: een betere tijd; UNCHANGED: bestaand record is beter of gelijk. */
  result: "CREATED" | "IMPROVED" | "UNCHANGED";
  hintCategory: HintCategory;
  elapsedMs: number;
  previousElapsedMs: number | null;
}

/**
 * Registreert een geldige prestatie als persoonlijk record. Atomair in PostgreSQL: een enkele
 * INSERT ... ON CONFLICT DO UPDATE ... WHERE, zodat twee gelijktijdige prestaties nooit een snellere door een
 * langzamere kunnen overschrijven (de WHERE vergelijkt met de rij die op dat moment vergrendeld is).
 * Herhaling met dezelfde bron is idempotent: gelijk is niet strikt beter, dus UNCHANGED.
 */
export async function registerBestRecord(tx: Tx, candidate: RecordCandidate): Promise<RegisterOutcome> {
  const category = hintCategoryFor(candidate.hintsUsed);
  if (!Number.isFinite(candidate.elapsedMs) || candidate.elapsedMs < 0) throw new Error("Ongeldige recordtijd");
  const previous = await tx.puzzleBestRecord.findUnique({ where: { userId_variantId_mode_hintCategory: { userId: candidate.userId, variantId: candidate.variantId, mode: candidate.mode, hintCategory: category } }, select: { elapsedMs: true } });
  const rows = await tx.$queryRaw<{ id: string; inserted: boolean }[]>`
    INSERT INTO "PuzzleBestRecord" ("id", "userId", "variantId", "mode", "hintCategory", "elapsedMs", "hintsUsed", "extraHintsUsed", "completedAt", "sessionId", "matchParticipantId", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${candidate.userId}, ${candidate.variantId}, ${candidate.mode}::"PuzzleRecordMode", ${category}::"PuzzleHintCategory", ${candidate.elapsedMs}, ${candidate.hintsUsed}, ${candidate.extraHintsUsed}, ${candidate.completedAt}, ${candidate.sessionId}, ${candidate.matchParticipantId ?? null}, now(), now())
    ON CONFLICT ("userId", "variantId", "mode", "hintCategory") DO UPDATE SET
      "elapsedMs" = EXCLUDED."elapsedMs", "hintsUsed" = EXCLUDED."hintsUsed", "extraHintsUsed" = EXCLUDED."extraHintsUsed",
      "completedAt" = EXCLUDED."completedAt", "sessionId" = EXCLUDED."sessionId", "matchParticipantId" = EXCLUDED."matchParticipantId", "updatedAt" = now()
    WHERE (EXCLUDED."elapsedMs", EXCLUDED."extraHintsUsed", EXCLUDED."hintsUsed", EXCLUDED."completedAt", EXCLUDED."sessionId")
        < ("PuzzleBestRecord"."elapsedMs", "PuzzleBestRecord"."extraHintsUsed", "PuzzleBestRecord"."hintsUsed", "PuzzleBestRecord"."completedAt", "PuzzleBestRecord"."sessionId")
    RETURNING "id", (xmax = 0) AS "inserted"`;
  const row = rows[0];
  return {
    result: !row ? "UNCHANGED" : row.inserted ? "CREATED" : "IMPROVED",
    hintCategory: category, elapsedMs: candidate.elapsedMs, previousElapsedMs: previous?.elapsedMs ?? null,
  };
}

// --- Lezen --------------------------------------------------------------------------------

const orderBy = [{ elapsedMs: "asc" }, { extraHintsUsed: "asc" }, { hintsUsed: "asc" }, { completedAt: "asc" }, { userId: "asc" }] as const satisfies Prisma.PuzzleBestRecordOrderByWithRelationInput[];

const variantSelect = { id: true, pieceCount: true, difficulty: true, rulesVersion: true, definition: { select: { imageUrl: true, storyNumber: true, geometryVersion: true } } } as const;

export interface OwnRecordView {
  id: string; variantId: string; mode: RecordMode; hintCategory: HintCategory;
  elapsedMs: number; hintsUsed: number; extraHintsUsed: number; completedAt: string;
  image: string; story: number; pieceCount: number; difficulty: string;
}

/** Alleen de eigen records van de ingelogde gebruiker; nooit privacy-afhankelijk. */
export async function listOwnRecords(userId: string, filters: { mode?: RecordMode; hintCategory?: HintCategory; pieceCount?: number; difficulty?: string } = {}): Promise<OwnRecordView[]> {
  const rows = await prisma.puzzleBestRecord.findMany({
    where: { userId, ...(filters.mode ? { mode: filters.mode } : {}), ...(filters.hintCategory ? { hintCategory: filters.hintCategory } : {}), variant: { ...(filters.pieceCount ? { pieceCount: filters.pieceCount } : {}), ...(filters.difficulty ? { difficulty: filters.difficulty as never } : {}) } },
    orderBy: [{ completedAt: "desc" }, { id: "asc" }], take: 200,
    include: { variant: { select: variantSelect } },
  });
  return rows.map((row) => ({
    id: row.id, variantId: row.variantId, mode: row.mode, hintCategory: row.hintCategory, elapsedMs: row.elapsedMs, hintsUsed: row.hintsUsed, extraHintsUsed: row.extraHintsUsed,
    completedAt: row.completedAt.toISOString(), image: row.variant.definition.imageUrl, story: row.variant.definition.storyNumber, pieceCount: row.variant.pieceCount, difficulty: row.variant.difficulty,
  }));
}

/**
 * De ids van geaccepteerde vrienden (beide richtingen van de vriendschap) die hun puzzelrecords delen.
 * De server bepaalt deze set; de client kan er nooit gebruikers aan toevoegen.
 */
export async function sharingFriendIds(viewerId: string): Promise<string[]> {
  const friendships = await prisma.friendship.findMany({ where: { status: "ACCEPTED", OR: [{ senderId: viewerId }, { receiverId: viewerId }] }, select: { senderId: true, receiverId: true } });
  const friendIds = [...new Set(friendships.map((f) => (f.senderId === viewerId ? f.receiverId : f.senderId)).filter((id) => id !== viewerId))];
  if (!friendIds.length) return [];
  const sharing = await prisma.user.findMany({ where: { id: { in: friendIds }, sharePuzzleRecords: true }, select: { id: true } });
  return sharing.map((user) => user.id);
}

export interface LeaderboardRow {
  rank: number; isMe: boolean; elapsedMs: number; hintsUsed: number; extraHintsUsed: number; completedAt: string;
  user: { id: string; handle: string; discriminator: string; avatarEmoji: string | null; avatarCharacterId: string | null; avatarBackgroundId: string | null; avatarFrameId: string | null; avatarDecorationId: string | null; avatarLightAccentId: string | null };
}
export interface LeaderboardView {
  variant: { id: string; image: string; story: number; pieceCount: number; difficulty: string };
  mode: RecordMode; hintCategory: HintCategory; rows: LeaderboardRow[];
}

/** Zoekt een bestaande variant; maakt er nooit een aan. Een onbekende variant geeft null en lekt niets. */
export async function findVariant(input: { variantId: string } | { imageUrl: string; pieceCount: number; difficulty: string }) {
  if ("variantId" in input) return prisma.puzzleVariant.findUnique({ where: { id: input.variantId }, select: variantSelect });
  return prisma.puzzleVariant.findFirst({
    where: { pieceCount: input.pieceCount, difficulty: input.difficulty as never, definition: { imageUrl: input.imageUrl } },
    orderBy: [{ rulesVersion: "desc" }, { createdAt: "desc" }], select: variantSelect,
  });
}

/**
 * Vriendenranglijst voor één exacte variant, modus en hintcategorie: alleen de kijker zelf en geaccepteerde
 * vrienden die delen aan staan. Eén query voor alle vrienden; de kijker ziet zichzelf altijd.
 */
export async function friendLeaderboard(viewerId: string, variantId: string, mode: RecordMode, hintCategory: HintCategory): Promise<LeaderboardView | null> {
  const variant = await prisma.puzzleVariant.findUnique({ where: { id: variantId }, select: variantSelect });
  if (!variant) return null;
  const allowed = [viewerId, ...(await sharingFriendIds(viewerId))];
  const rows = await prisma.puzzleBestRecord.findMany({
    where: { variantId, mode, hintCategory, userId: { in: allowed } }, orderBy: [...orderBy], take: LEADERBOARD_LIMIT,
    select: { userId: true, elapsedMs: true, hintsUsed: true, extraHintsUsed: true, completedAt: true, user: { select: { id: true, handle: true, discriminator: true, avatarEmoji: true, avatarCharacterId: true, avatarBackgroundId: true, avatarFrameId: true, avatarDecorationId: true, avatarLightAccentId: true } } },
  });
  return {
    variant: { id: variant.id, image: variant.definition.imageUrl, story: variant.definition.storyNumber, pieceCount: variant.pieceCount, difficulty: variant.difficulty },
    mode, hintCategory,
    rows: rows.map((row, index) => ({ rank: index + 1, isMe: row.userId === viewerId, elapsedMs: row.elapsedMs, hintsUsed: row.hintsUsed, extraHintsUsed: row.extraHintsUsed, completedAt: row.completedAt.toISOString(), user: row.user })),
  };
}

/** Records van één vriend voor zijn profiel: alleen bij een geaccepteerde vriendschap én toestemming van de eigenaar. */
export async function sharedRecordsOf(viewerId: string, ownerId: string, limit = 5): Promise<OwnRecordView[] | null> {
  if (viewerId === ownerId) return listOwnRecords(ownerId).then((rows) => rows.slice(0, limit));
  const friendship = await prisma.friendship.findFirst({ where: { status: "ACCEPTED", OR: [{ senderId: viewerId, receiverId: ownerId }, { senderId: ownerId, receiverId: viewerId }] }, select: { id: true } });
  if (!friendship) return null;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { sharePuzzleRecords: true } });
  if (!owner?.sharePuzzleRecords) return null;
  const rows = await listOwnRecords(ownerId);
  // De meest recente records; tijden van verschillende varianten zijn onderling niet vergelijkbaar.
  return rows.slice(0, limit);
}
