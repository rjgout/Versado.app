import { requirePuzzleContent, requireNewPuzzleStart } from "@/lib/puzzle/access";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { emitToRoom, emitToUser } from "@/lib/realtime";
import { userDayKey } from "@/lib/timeZone";
import { recordLearningActivity } from "@/lib/streak";
import { settleGroups } from "@/lib/puzzle/collision";
import { anchorGroup, connectGroups, isPuzzleComplete, moveGroup, newPuzzleSnapshot, rotateGroup, validPuzzleStructure } from "@/lib/puzzle/engine";
import { cachedPuzzleGeometry } from "@/lib/puzzle/geometryCache";
import { applyDelta, mergeDeltas, snapshotDelta, type PuzzleDelta } from "@/lib/puzzle/delta";
import { puzzleHintTarget } from "@/lib/puzzle/hints";
import { PuzzleServiceError } from "@/lib/puzzle/errors";
import { sendPuzzleNotice } from "@/lib/puzzle/puzzleNotify";
import { multiplayerConfig } from "@/lib/puzzle/multiplayerConfig";
import { areAcceptedFriends, ensureVariant } from "@/lib/puzzle/variants";
import { sessionInclude, snapshotSchema, type SoloAction } from "@/lib/puzzle/solo";
import { COOP_PIECE_COUNTS, puzzlePolicy, PUZZLE_HINT_DURATION_MS, type PuzzleDifficulty, type PuzzleHint, type PuzzleHintType, type PuzzlePieceCount, type PuzzleSnapshot } from "@/lib/puzzle/types";

// Samen: één gedeelde puzzelwereld voor maximaal vier vrienden. PostgreSQL is de
// bron van waarheid; de sessierij wordt per actie met FOR UPDATE vergrendeld,
// dus ook twee app-instances schrijven nooit tegelijk. Socket.IO (src/server/
// puzzle.ts) verspreidt alleen wat hier is vastgelegd.

export type CoopOperation = Extract<SoloAction, { kind: "move" | "rotate" | "connect" | "anchor" | "settle" }>;
export type CoopHintRequest = { hint: PuzzleHintType; confirmPersonal?: boolean; pieceId?: number; filter?: "CORNERS" | "EDGES" | "MIDDLES" | null };

export interface CoopParticipantView { userId: string; handle: string; discriminator: string; role: string; connectionsMade: number; includedHintsUsed: number; }
export interface CoopLockView { groupId: string; userId: string; expiresAt: string; }
export interface CoopInviteView { id: string; userId: string; handle: string; discriminator: string; status: string; expiresAt: string; }
export interface CoopState {
  id: string;
  mode: "COOP";
  version: number;
  status: string;
  image: string;
  story: number;
  seed: string;
  geometryVersion: number;
  pieceCount: PuzzlePieceCount;
  difficulty: PuzzleDifficulty;
  rulesVersion: number;
  snapshot: PuzzleSnapshot;
  completedAt: string | null;
  participants: CoopParticipantView[];
  invites: CoopInviteView[];
  locks: CoopLockView[];
  ownerId: string;
  me: { userId: string; hint: PuzzleHint | null; includedRemaining: number | null; hintBalance: number };
  serverNow: number;
}

type Tx = Prisma.TransactionClient;
const tx_options = { timeout: 20_000, maxWait: 10_000 } as const;
const room = (sessionId: string) => `puzzle:${sessionId}`;

function parseSnapshot(raw: string): PuzzleSnapshot { return snapshotSchema.parse(JSON.parse(raw)) as PuzzleSnapshot; }

async function lockCoopSession(tx: Tx, sessionId: string) {
  await requirePuzzleContent(tx);
  // Alle schrijfacties van één gedeelde puzzel lopen serieel, ook tussen instances.
  await tx.$queryRaw`SELECT "id" FROM "PuzzleSession" WHERE "id" = ${sessionId} AND "mode" = 'COOP' FOR UPDATE`;
  return tx.puzzleSession.findFirst({ where: { id: sessionId, mode: "COOP" }, include: sessionInclude });
}
type Row = NonNullable<Awaited<ReturnType<typeof lockCoopSession>>>;

async function requireParticipant(tx: Tx, sessionId: string, userId: string) {
  const participant = await tx.puzzleSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } });
  if (!participant) throw new PuzzleServiceError("FORBIDDEN");
  return participant;
}

function geometryOf(row: Row) {
  return cachedPuzzleGeometry(row.variant.pieceCount as PuzzlePieceCount, row.variant.definition.seed, row.variant.definition.geometryVersion);
}

async function activeLocks(tx: Tx, sessionId: string, now: Date) {
  await tx.puzzleLock.deleteMany({ where: { sessionId, expiresAt: { lte: now } } });
  return tx.puzzleLock.findMany({ where: { sessionId } });
}

async function buildState(tx: Tx, row: Row, userId: string, now: Date): Promise<CoopState> {
  const [participants, invites, locks, me] = await Promise.all([
    tx.puzzleSessionParticipant.findMany({ where: { sessionId: row.id }, include: { user: { select: { id: true, handle: true, discriminator: true } } }, orderBy: [{ joinedAt: "asc" }, { id: "asc" }] }),
    tx.puzzleInvite.findMany({ where: { sessionId: row.id, status: "PENDING", expiresAt: { gt: now } }, include: { to: { select: { id: true, handle: true, discriminator: true } } }, orderBy: { createdAt: "asc" } }),
    tx.puzzleLock.findMany({ where: { sessionId: row.id, expiresAt: { gt: now } } }),
    tx.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true } }),
  ]);
  const mine = participants.find((participant) => participant.userId === userId);
  const included = puzzlePolicy(row.variant.difficulty as PuzzleDifficulty, row.variant.rulesVersion).includedHints;
  let hint: PuzzleHint | null = null;
  if (mine?.activeHint) { const parsed = JSON.parse(mine.activeHint) as PuzzleHint; if (parsed.expiresAt && Date.parse(parsed.expiresAt) > now.getTime()) hint = parsed; }
  return {
    id: row.id, mode: "COOP", version: row.version, status: row.status, image: row.variant.definition.imageUrl, story: row.variant.definition.storyNumber,
    seed: row.variant.definition.seed, geometryVersion: row.variant.definition.geometryVersion, pieceCount: row.variant.pieceCount as PuzzlePieceCount,
    difficulty: row.variant.difficulty as PuzzleDifficulty, rulesVersion: row.variant.rulesVersion, snapshot: parseSnapshot(row.snapshot),
    completedAt: row.completedAt?.toISOString() ?? null, ownerId: row.ownerId,
    participants: participants.map((p) => ({ userId: p.userId, handle: p.user.handle, discriminator: p.user.discriminator, role: p.role, connectionsMade: p.connectionsMade, includedHintsUsed: p.includedHintsUsed })),
    invites: invites.map((invite) => ({ id: invite.id, userId: invite.toUserId, handle: invite.to.handle, discriminator: invite.to.discriminator, status: invite.status, expiresAt: invite.expiresAt.toISOString() })),
    locks: locks.map((lock) => ({ groupId: lock.groupId, userId: lock.userId, expiresAt: lock.expiresAt.toISOString() })),
    me: { userId, hint, includedRemaining: included === null ? null : Math.max(0, included - (mine?.includedHintsUsed ?? 0)), hintBalance: me.hintBalance },
    serverNow: now.getTime(),
  };
}

// --- Aanmaken, uitnodigen, reageren -------------------------------------------

export async function createCoopSession(userId: string, content: number | string, pieceCount: (typeof COOP_PIECE_COUNTS)[number], difficulty: PuzzleDifficulty, friendIds: string[]) {
  await requireNewPuzzleStart(userId);
  if (!COOP_PIECE_COUNTS.includes(pieceCount)) throw new PuzzleServiceError("INVALID");
  const invitees = [...new Set(friendIds)].filter((id) => id !== userId);
  if (invitees.length > multiplayerConfig().maxCoopParticipants - 1) throw new PuzzleServiceError("CAPACITY");
  const { definition, variant } = await ensureVariant(content, pieceCount, difficulty);
  const sessionId = await prisma.$transaction(async (tx) => {
    // Dubbel klikken of twee apparaten maken geen twee gelijke nieuwe puzzels.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const recent = await tx.puzzleSession.findFirst({ where: { ownerId: userId, mode: "COOP", variantId: variant.id, status: "ACTIVE", startedAt: { gt: new Date(Date.now() - 10_000) } }, select: { id: true } });
    if (recent) return recent.id;
    const geometry = cachedPuzzleGeometry(pieceCount, definition.seed, definition.geometryVersion);
    const session = await tx.puzzleSession.create({ data: { ownerId: userId, variantId: variant.id, mode: "COOP", snapshot: JSON.stringify(newPuzzleSnapshot(geometry, difficulty)) } });
    await tx.puzzleSessionParticipant.create({ data: { sessionId: session.id, userId, role: "OWNER" } });
    return session.id;
  }, tx_options);
  if (invitees.length) await inviteToCoop(userId, sessionId, invitees);
  return sessionId;
}

export async function inviteToCoop(userId: string, sessionId: string, friendIds: string[]) {
  const config = multiplayerConfig();
  const targets = [...new Set(friendIds)].filter((id) => id !== userId);
  const sent: string[] = [];
  let fromHandle = "";
  await prisma.$transaction(async (tx) => {
    const row = await lockCoopSession(tx, sessionId);
    if (!row) throw new PuzzleServiceError("NOT_FOUND");
    if (row.ownerId !== userId) throw new PuzzleServiceError("FORBIDDEN");
    if (row.status !== "ACTIVE") throw new PuzzleServiceError("CLOSED");
    const now = new Date();
    fromHandle = (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true } })).handle;
    // Alleen geaccepteerde vrienden; geen openbare zoekfunctie.
    for (const id of targets) if (!(await areAcceptedFriends(tx, userId, id))) throw new PuzzleServiceError("NOT_FRIENDS");
    const participantIds = new Set((await tx.puzzleSessionParticipant.findMany({ where: { sessionId }, select: { userId: true } })).map((p) => p.userId));
    const pending = await tx.puzzleInvite.findMany({ where: { sessionId, status: "PENDING", expiresAt: { gt: now } }, select: { toUserId: true } });
    const pendingIds = new Set(pending.map((invite) => invite.toUserId));
    const fresh = targets.filter((id) => !participantIds.has(id) && !pendingIds.has(id));
    if (participantIds.size + pendingIds.size + fresh.length > config.maxCoopParticipants) throw new PuzzleServiceError("CAPACITY");
    for (const id of fresh) {
      // Een eerdere weigering/intrekking/verloop wordt hergebruikt; nooit twee rijen per vriend.
      await tx.puzzleInvite.upsert({
        where: { sessionId_toUserId: { sessionId, toUserId: id } },
        create: { kind: "COOP", sessionId, fromUserId: userId, toUserId: id, expiresAt: new Date(now.getTime() + config.coopInviteTtlMs) },
        update: { status: "PENDING", fromUserId: userId, createdAt: now, expiresAt: new Date(now.getTime() + config.coopInviteTtlMs), respondedAt: null },
      });
      sent.push(id);
    }
  }, tx_options);
  for (const id of sent) { sendPuzzleNotice(id, { type: "COOP_INVITE", fromHandle, sessionId }); emitToUser(id, "puzzle_invites_changed"); }
  return { invited: sent };
}

export async function respondToCoopInvite(userId: string, inviteId: string, accept: boolean) {
  const config = multiplayerConfig();
  let notice: { to: string; fromHandle: string; sessionId: string; accepted: boolean } | null = null;
  const sessionId = await prisma.$transaction(async (tx) => {
    const invite = await tx.puzzleInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.kind !== "COOP" || !invite.sessionId || invite.toUserId !== userId) throw new PuzzleServiceError("NOT_FOUND");
    const row = await lockCoopSession(tx, invite.sessionId);
    if (!row) throw new PuzzleServiceError("NOT_FOUND");
    // Na het vergrendelen opnieuw lezen: een gelijktijdige intrekking of acceptatie wint van oude kennis.
    const current = await tx.puzzleInvite.findUniqueOrThrow({ where: { id: inviteId } });
    const now = new Date();
    if (current.status === "ACCEPTED" && accept) return row.id;
    if (current.status !== "PENDING") throw new PuzzleServiceError(current.status === "REVOKED" ? "CLOSED" : "EXPIRED");
    if (current.expiresAt <= now) { await tx.puzzleInvite.update({ where: { id: inviteId }, data: { status: "EXPIRED", respondedAt: now } }); throw new PuzzleServiceError("EXPIRED"); }
    const fromHandle = (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true } })).handle;
    if (!accept) {
      await tx.puzzleInvite.update({ where: { id: inviteId }, data: { status: "DECLINED", respondedAt: now } });
      notice = { to: row.ownerId, fromHandle, sessionId: row.id, accepted: false };
      return row.id;
    }
    if (row.status !== "ACTIVE") throw new PuzzleServiceError("CLOSED");
    // Het maximum wordt binnen dezelfde vergrendelde transactie geteld: twee
    // gelijktijdige acceptaties kunnen samen nooit een vijfde deelnemer worden.
    const count = await tx.puzzleSessionParticipant.count({ where: { sessionId: row.id } });
    if (count >= config.maxCoopParticipants) throw new PuzzleServiceError("CAPACITY");
    await tx.puzzleSessionParticipant.upsert({ where: { sessionId_userId: { sessionId: row.id, userId } }, create: { sessionId: row.id, userId }, update: {} });
    await tx.puzzleInvite.update({ where: { id: inviteId }, data: { status: "ACCEPTED", respondedAt: now } });
    notice = { to: row.ownerId, fromHandle, sessionId: row.id, accepted: true };
    return row.id;
  }, tx_options);
  const result = notice as { to: string; fromHandle: string; sessionId: string; accepted: boolean } | null;
  if (result) {
    sendPuzzleNotice(result.to, { type: result.accepted ? "COOP_ACCEPTED" : "COOP_DECLINED", fromHandle: result.fromHandle, sessionId: result.sessionId });
    emitToUser(result.to, "puzzle_invites_changed");
    emitToRoom(room(result.sessionId), "puzzle:participants", { sessionId: result.sessionId });
  }
  return sessionId;
}

export async function revokeCoopInvite(userId: string, inviteId: string) {
  let target: { to: string; fromHandle: string; sessionId: string } | null = null;
  await prisma.$transaction(async (tx) => {
    const invite = await tx.puzzleInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.kind !== "COOP" || !invite.sessionId || invite.fromUserId !== userId) throw new PuzzleServiceError("NOT_FOUND");
    await lockCoopSession(tx, invite.sessionId);
    const changed = await tx.puzzleInvite.updateMany({ where: { id: inviteId, status: "PENDING" }, data: { status: "REVOKED", respondedAt: new Date() } });
    if (changed.count) target = { to: invite.toUserId, fromHandle: (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true } })).handle, sessionId: invite.sessionId };
  }, tx_options);
  const result = target as { to: string; fromHandle: string; sessionId: string } | null;
  if (result) { sendPuzzleNotice(result.to, { type: "COOP_REVOKED", fromHandle: result.fromHandle, sessionId: result.sessionId }); emitToUser(result.to, "puzzle_invites_changed"); }
}

/** Een deelnemer verlaat de puzzel; de voortgang blijft van de rest. De eigenaar kan niet vertrekken. */
export async function leaveCoopSession(userId: string, sessionId: string) {
  await prisma.$transaction(async (tx) => {
    const row = await lockCoopSession(tx, sessionId);
    if (!row) throw new PuzzleServiceError("NOT_FOUND");
    await requireParticipant(tx, sessionId, userId);
    if (row.ownerId === userId) throw new PuzzleServiceError("FORBIDDEN");
    await tx.puzzleLock.deleteMany({ where: { sessionId, userId } });
    await tx.puzzleSessionParticipant.delete({ where: { sessionId_userId: { sessionId, userId } } });
  }, tx_options);
  emitToRoom(room(sessionId), "puzzle:participants", { sessionId });
}

// --- Lezen en herstel ------------------------------------------------------------

export async function getCoopState(userId: string, sessionId: string): Promise<CoopState> {
  return prisma.$transaction(async (tx) => {
    await requirePuzzleContent(tx);
    const row = await tx.puzzleSession.findFirst({ where: { id: sessionId, mode: "COOP" }, include: sessionInclude });
    if (!row) throw new PuzzleServiceError("NOT_FOUND");
    const participant = await requireParticipant(tx, sessionId, userId);
    await tx.puzzleSessionParticipant.update({ where: { id: participant.id }, data: { lastSeenAt: new Date() } });
    return buildState(tx, row, userId, new Date());
  }, tx_options);
}

/** Alles sinds `version`: een patch als de actiehistorie sluit, anders een volledige snapshot. */
export async function syncCoopState(userId: string, sessionId: string, version: number): Promise<{ state?: CoopState; patch?: PuzzleDelta; upToDate?: boolean }> {
  const state = await getCoopState(userId, sessionId);
  if (version === state.version) return { upToDate: true };
  if (version > state.version || state.version - version > 200) return { state };
  const actions = await prisma.puzzleAction.findMany({ where: { sessionId, version: { gt: version, lte: state.version }, type: { not: "hint" } }, orderBy: { version: "asc" } });
  const deltas: PuzzleDelta[] = [];
  for (const action of actions) { try { const parsed = JSON.parse(action.payload) as { delta?: PuzzleDelta }; if (parsed.delta) deltas.push(parsed.delta); } catch { /* onleesbare actie: volledige snapshot */ } }
  const merged = deltas.length === state.version - version ? mergeDeltas(deltas) : null;
  return merged && merged.fromVersion === version && merged.version === state.version ? { patch: merged } : { state };
}

// --- Locks -------------------------------------------------------------------------

export type LockResult = { ok: true; token: string; expiresAt: string; locks: CoopLockView[] } | { ok: false; holder: string | null; reason: "LOCKED" | "GONE" | "CLOSED" };

export async function acquireCoopLock(userId: string, sessionId: string, groupId: string, now: Date = new Date()): Promise<LockResult> {
  const result = await prisma.$transaction(async (tx): Promise<LockResult> => {
    const row = await lockCoopSession(tx, sessionId);
    if (!row) throw new PuzzleServiceError("NOT_FOUND");
    await requireParticipant(tx, sessionId, userId);
    if (row.status !== "ACTIVE") return { ok: false, holder: null, reason: "CLOSED" };
    const group = parseSnapshot(row.snapshot).groups.find((candidate) => candidate.id === groupId);
    if (!group || group.anchored) return { ok: false, holder: null, reason: "GONE" };
    const locks = await activeLocks(tx, sessionId, now);
    const existing = locks.find((lock) => lock.groupId === groupId);
    if (existing && existing.userId !== userId) return { ok: false, holder: existing.userId, reason: "LOCKED" };
    // Eén vastgehouden groep per speler: een nieuwe pak geeft de vorige vrij.
    await tx.puzzleLock.deleteMany({ where: { sessionId, userId, groupId: { not: groupId } } });
    const expiresAt = new Date(now.getTime() + multiplayerConfig().lockLeaseMs);
    const token = existing?.token ?? randomUUID();
    await tx.puzzleLock.upsert({ where: { sessionId_groupId: { sessionId, groupId } }, create: { sessionId, groupId, userId, token, expiresAt }, update: { expiresAt, userId, token } });
    const all = await tx.puzzleLock.findMany({ where: { sessionId, expiresAt: { gt: now } } });
    return { ok: true, token, expiresAt: expiresAt.toISOString(), locks: all.map((lock) => ({ groupId: lock.groupId, userId: lock.userId, expiresAt: lock.expiresAt.toISOString() })) };
  }, tx_options);
  if (result.ok) emitToRoom(room(sessionId), "puzzle:locks", { sessionId, locks: result.locks });
  return result;
}

export async function renewCoopLock(userId: string, sessionId: string, groupId: string, token: string): Promise<{ ok: boolean; expiresAt?: string }> {
  await requirePuzzleContent();
  const expiresAt = new Date(Date.now() + multiplayerConfig().lockLeaseMs);
  const changed = await prisma.puzzleLock.updateMany({ where: { sessionId, groupId, userId, token, expiresAt: { gt: new Date() } }, data: { expiresAt } });
  return changed.count ? { ok: true, expiresAt: expiresAt.toISOString() } : { ok: false };
}

export async function releaseCoopLocks(userId: string, sessionId: string, options: { groupId?: string; token?: string; tokens?: string[] } = {}) {
  const where: Prisma.PuzzleLockWhereInput = { sessionId, userId, ...(options.groupId ? { groupId: options.groupId } : {}), ...(options.token ? { token: options.token } : {}), ...(options.tokens ? { token: { in: options.tokens } } : {}) };
  const removed = await prisma.puzzleLock.deleteMany({ where });
  if (removed.count) {
    const locks = await prisma.puzzleLock.findMany({ where: { sessionId, expiresAt: { gt: new Date() } } });
    emitToRoom(room(sessionId), "puzzle:locks", { sessionId, locks: locks.map((lock) => ({ groupId: lock.groupId, userId: lock.userId, expiresAt: lock.expiresAt.toISOString() })) });
  }
  return removed.count;
}

// --- Definitieve acties ---------------------------------------------------------

export interface CoopCommitResult {
  ok: true;
  version: number;
  delta: PuzzleDelta | null;
  completed: boolean;
  /** Telde deze actie als geldige bijdrage aan de persoonlijke reeks? */
  contribution: { counted: boolean; dayEarned: boolean; currentStreak: number } | null;
  duplicate?: boolean;
}

export async function commitCoopAction(userId: string, sessionId: string, input: { actionId: string; baseVersion?: number; lockToken?: string; operation: CoopOperation; /** Alleen tests: een ander "nu". */ now?: Date }): Promise<CoopCommitResult> {
  let streakEvent: { dayEarned: boolean; currentStreak: number } | null = null;
  let completedNow = false;
  let locksChanged = false;
  const outcome = await prisma.$transaction(async (tx): Promise<CoopCommitResult> => {
    const row = await lockCoopSession(tx, sessionId);
    if (!row) throw new PuzzleServiceError("NOT_FOUND");
    const participant = await requireParticipant(tx, sessionId, userId);
    const now = input.now ?? new Date();
    const prior = await tx.puzzleAction.findUnique({ where: { sessionId_actionId: { sessionId, actionId: input.actionId } } });
    if (prior) {
      // Een retry na een verloren response voert nooit twee keer uit en geeft hetzelfde resultaat.
      if (prior.userId !== userId) throw new PuzzleServiceError("CONFLICT");
      const stored = JSON.parse(prior.payload) as { delta?: PuzzleDelta | null; contribution?: CoopCommitResult["contribution"] };
      return { ok: true, version: row.version, delta: stored.delta ?? null, completed: row.status !== "ACTIVE", contribution: stored.contribution ?? null, duplicate: true };
    }
    if (row.status !== "ACTIVE") throw new PuzzleServiceError("CLOSED");
    if (input.baseVersion !== undefined && input.baseVersion > row.version) throw new PuzzleServiceError("CONFLICT", { version: row.version });
    const snapshot = parseSnapshot(row.snapshot); const difficulty = row.variant.difficulty as PuzzleDifficulty; const geometry = geometryOf(row);
    if (!validPuzzleStructure(snapshot, geometry, difficulty, row.variant.rulesVersion)) throw new PuzzleServiceError("CONFLICT", { version: row.version });
    const locks = await activeLocks(tx, sessionId, now);
    const holds = (groupId: string) => locks.some((lock) => lock.groupId === groupId && lock.userId === userId && lock.token === input.lockToken);
    const heldByOther = (groupId: string) => locks.some((lock) => lock.groupId === groupId && lock.userId !== userId);
    const operation = input.operation;
    let next = snapshot; let mergedInto: string | null = null; let removedIds: string[] = [];
    if (operation.kind === "move") { if (!holds(operation.groupId)) throw new PuzzleServiceError("NO_LOCK"); next = moveGroup(snapshot, geometry, operation.groupId, operation.x, operation.y); }
    else if (operation.kind === "rotate") { if (difficulty !== "MASTER") throw new PuzzleServiceError("INVALID"); if (!holds(operation.groupId)) throw new PuzzleServiceError("NO_LOCK"); next = rotateGroup(snapshot, geometry, operation.groupId); }
    else if (operation.kind === "anchor") { if (!holds(operation.groupId)) throw new PuzzleServiceError("NO_LOCK"); next = anchorGroup(snapshot, geometry, difficulty, operation.groupId, row.variant.rulesVersion); }
    else if (operation.kind === "settle") {
      // Ruimte maken heeft geen lock nodig (de speler liet de groep al los) maar respecteert die van anderen: een groep die iemand
      // vasthoudt beweegt nooit, en een focusgroep die een ander vasthoudt blijft helemaal met rust. De server bepaalt de
      // verplaatsingen zelf vanuit de actuele stand; er komt geen lijst posities van de client. Geen verandering = geen versie.
      if (!heldByOther(operation.groupId)) next = settleGroups(snapshot, geometry, { focusGroupId: operation.groupId, difficulty, rulesVersion: row.variant.rulesVersion, immovable: new Set(locks.map((lock) => lock.groupId)), viewport: operation.viewport });
    }
    else {
      const one = snapshot.groups.find((group) => group.pieceIds.includes(operation.a)); const two = snapshot.groups.find((group) => group.pieceIds.includes(operation.b));
      if (!one || !two || one.id === two.id) throw new PuzzleServiceError("CONFLICT", { version: row.version });
      // De speler houdt een van beide groepen vast; de andere mag door niemand anders worden vastgehouden.
      const mine = holds(one.id) ? one : holds(two.id) ? two : null;
      if (!mine) throw new PuzzleServiceError("NO_LOCK");
      const other = mine === one ? two : one;
      if (heldByOther(other.id)) throw new PuzzleServiceError("LOCKED", { holder: locks.find((lock) => lock.groupId === other.id)?.userId });
      next = connectGroups(snapshot, geometry, difficulty, operation.a, operation.b, row.variant.rulesVersion);
      if (next !== snapshot) { const stillThere = new Set(next.groups.map((group) => group.id)); removedIds = snapshot.groups.filter((group) => !stillThere.has(group.id)).map((group) => group.id); mergedInto = next.groups.find((group) => group.pieceIds.includes(operation.a))?.id ?? null; }
    }
    if (next === snapshot) {
      // Ongeldige of niets veranderende actie: geen versie, geen log, geen reeks.
      return { ok: true, version: row.version, delta: null, completed: false, contribution: null };
    }
    const version = row.version + 1;
    const finished = next.completedAt !== null || isPuzzleComplete(next, geometry, difficulty, row.variant.rulesVersion);
    const completedAt = finished ? row.completedAt ?? new Date(next.completedAt ?? now) : null;
    next = { ...next, version, completedAt: completedAt?.toISOString() ?? null };
    const delta = snapshotDelta(snapshot, next, row.version, version);
    // Lockidentiteiten volgen de fusie: verdwenen groepen verliezen hun lock en de
    // canonieke groep krijgt de lock van de speler, zodat een volgende snap/anchor kan.
    if (removedIds.length) {
      await tx.puzzleLock.deleteMany({ where: { sessionId, groupId: { in: removedIds } } });
      if (mergedInto) await tx.puzzleLock.upsert({ where: { sessionId_groupId: { sessionId, groupId: mergedInto } }, create: { sessionId, groupId: mergedInto, userId, token: input.lockToken ?? randomUUID(), expiresAt: new Date(now.getTime() + multiplayerConfig().lockLeaseMs) }, update: { userId, token: input.lockToken ?? randomUUID(), expiresAt: new Date(now.getTime() + multiplayerConfig().lockLeaseMs) } });
      locksChanged = true;
    }
    if (finished) { await tx.puzzleLock.deleteMany({ where: { sessionId } }); locksChanged = true; }
    else if (input.lockToken) await tx.puzzleLock.updateMany({ where: { sessionId, userId, token: input.lockToken }, data: { expiresAt: new Date(now.getTime() + multiplayerConfig().lockLeaseMs) } });
    // Reeks: alleen een nieuwe, geldige verbinding die deze speler zelf maakte (ook via
    // de bordverankering) telt. Verplaatsen, selecteren, hints en andermans werk nooit.
    let contribution: CoopCommitResult["contribution"] = null;
    if (next.connections.length > snapshot.connections.length) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
      const day = userDayKey(user, now);
      const streak = await recordLearningActivity(tx, userId, { kind: "GAME", answered: 1, required: 1, key: `puzzle-coop:${sessionId}:${day}` }, now);
      contribution = { counted: streak.counted, dayEarned: streak.dayEarned, currentStreak: streak.currentStreak };
      if (streak.counted && !streak.duplicate) streakEvent = { dayEarned: streak.dayEarned, currentStreak: streak.currentStreak };
      await tx.puzzleSessionParticipant.update({ where: { id: participant.id }, data: { connectionsMade: { increment: next.connections.length - snapshot.connections.length }, lastSeenAt: now } });
    }
    await tx.puzzleAction.create({ data: { sessionId, actionId: input.actionId, type: operation.kind, payload: JSON.stringify({ operation, delta, contribution }), version, userId } });
    await tx.puzzleSession.update({ where: { id: sessionId }, data: { snapshot: JSON.stringify(next), version, lastActivityAt: now, completedAt, status: finished ? "COMPLETED" : "ACTIVE" } });
    completedNow = finished && !row.completedAt;
    return { ok: true, version, delta, completed: finished, contribution };
  }, tx_options);

  if (outcome.delta && !outcome.duplicate) {
    emitToRoom(room(sessionId), "puzzle:delta", { sessionId, actor: userId, delta: outcome.delta });
    if (locksChanged) { const locks = await prisma.puzzleLock.findMany({ where: { sessionId, expiresAt: { gt: new Date() } } }); emitToRoom(room(sessionId), "puzzle:locks", { sessionId, locks: locks.map((lock) => ({ groupId: lock.groupId, userId: lock.userId, expiresAt: lock.expiresAt.toISOString() })) }); }
  }
  const event = streakEvent as { dayEarned: boolean; currentStreak: number } | null;
  if (event) emitToUser(userId, "streak_changed", { dayEarned: event.dayEarned, currentStreak: event.currentStreak });
  if (completedNow) await announceCoopCompletion(sessionId);
  return outcome;
}

async function announceCoopCompletion(sessionId: string) {
  const participants = await prisma.puzzleSessionParticipant.findMany({ where: { sessionId }, select: { userId: true } });
  emitToRoom(room(sessionId), "puzzle:completed", { sessionId });
  for (const { userId } of participants) { sendPuzzleNotice(userId, { type: "COOP_COMPLETED", sessionId }); emitToUser(userId, "puzzle_invites_changed"); }
}

// --- Persoonlijke hints --------------------------------------------------------------

/** Hints zijn persoonlijk: eigen budget per puzzel, eigen weergave, nooit in de gedeelde snapshot. */
export async function spendCoopHint(userId: string, sessionId: string, actionId: string, request: CoopHintRequest): Promise<{ hint: PuzzleHint | null; hintBalance: number; includedRemaining: number | null; inventoryChanged: boolean }> {
  let inventoryChanged = false;
  const result = await prisma.$transaction(async (tx) => {
    const row = await lockCoopSession(tx, sessionId);
    if (!row) throw new PuzzleServiceError("NOT_FOUND");
    const participant = await requireParticipant(tx, sessionId, userId);
    const now = new Date();
    const snapshot = parseSnapshot(row.snapshot); const difficulty = row.variant.difficulty as PuzzleDifficulty;
    const included = puzzlePolicy(difficulty, row.variant.rulesVersion).includedHints;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true } });
    const unchanged = () => ({ hint: parseActive(participant.activeHint, now), hintBalance: user.hintBalance, includedRemaining: included === null ? null : Math.max(0, included - participant.includedHintsUsed) });
    const prior = await tx.puzzleAction.findUnique({ where: { sessionId_actionId: { sessionId, actionId } } });
    if (prior) return unchanged();
    if (row.status !== "ACTIVE") throw new PuzzleServiceError("CLOSED");
    // Een lopende hint beschermt tegen snelle herhaalde klikken met verschillende actionIds.
    if (parseActive(participant.activeHint, now)) return unchanged();
    const geometry = geometryOf(row);
    const target = puzzleHintTarget(snapshot, geometry, request.hint, request.pieceId, request.filter);
    if (!target || (target.type === "FILTER" && !target.pieceIds.length)) return unchanged();
    const extra = included !== null && participant.includedHintsUsed >= included;
    let balance = user.hintBalance;
    if (extra) {
      // Zelfde lockvolgorde als Solo: sessie → gebruiker; nooit negatief saldo, nooit dubbel.
      if (balance <= 0) throw new PuzzleServiceError("HINT_EMPTY", { hintBalance: balance });
      if (!request.confirmPersonal) throw new PuzzleServiceError("HINT_CONFIRM", { hintBalance: balance });
      const consumed = await tx.user.updateMany({ where: { id: userId, hintBalance: { gt: 0 } }, data: { hintBalance: { decrement: 1 } } });
      if (consumed.count !== 1) throw new PuzzleServiceError("HINT_EMPTY", { hintBalance: 0 });
      balance -= 1; inventoryChanged = true;
    }
    const hint: PuzzleHint = { source: extra ? "PERSONAL" : "INCLUDED", type: request.hint, at: now.toISOString(), extra, actionId, expiresAt: new Date(now.getTime() + PUZZLE_HINT_DURATION_MS).toISOString(), target };
    await tx.puzzleSessionParticipant.update({ where: { id: participant.id }, data: { activeHint: JSON.stringify(hint), includedHintsUsed: extra ? undefined : { increment: 1 } } });
    // Geen versieverhoging: een hint verandert de gedeelde puzzel niet.
    await tx.puzzleAction.create({ data: { sessionId, actionId, type: "hint", payload: JSON.stringify({ hint: request.hint, extra }), version: row.version, userId } });
    return { hint, hintBalance: balance, includedRemaining: included === null ? null : Math.max(0, included - participant.includedHintsUsed - (extra ? 0 : 1)) };
  }, tx_options);
  if (inventoryChanged) emitToUser(userId, "hints_changed");
  return { ...result, inventoryChanged };
}

function parseActive(raw: string | null, now: Date): PuzzleHint | null {
  if (!raw) return null;
  const hint = JSON.parse(raw) as PuzzleHint;
  return hint.expiresAt && Date.parse(hint.expiresAt) > now.getTime() ? hint : null;
}

// --- Overzichten ---------------------------------------------------------------------

export async function listCoopOverview(userId: string) {
  await requirePuzzleContent();
  const now = new Date();
  const [sessions, invites, sent] = await Promise.all([
    prisma.puzzleSession.findMany({ where: { mode: "COOP", participants: { some: { userId } }, status: { in: ["ACTIVE", "COMPLETED"] } }, orderBy: { lastActivityAt: "desc" }, take: 20, include: { variant: { include: { definition: true } }, participants: { include: { user: { select: { id: true, handle: true } } } } } }),
    prisma.puzzleInvite.findMany({ where: { toUserId: userId, kind: "COOP", status: "PENDING", expiresAt: { gt: now } }, orderBy: { createdAt: "desc" }, include: { from: { select: { id: true, handle: true } }, session: { include: { variant: { include: { definition: true } } } } } }),
    prisma.puzzleInvite.findMany({ where: { fromUserId: userId, kind: "COOP", status: "PENDING", expiresAt: { gt: now } }, include: { to: { select: { id: true, handle: true } } } }),
  ]);
  return { sessions, invites, sent };
}

export { applyDelta };
