import type { Server as SocketIOServer, Socket } from "socket.io";
import { prisma } from "@/lib/db";
import { getT } from "@/lib/i18n";
import { notifyGameInvite, removeNotificationsByUrl } from "@/lib/notify";
import { setMatchChangeListener } from "@/lib/realtime";
import { canUseQuickMissionary } from "@/lib/snelleZendeling/access";
import { announceMatchChanged, getMatchView, matchChannel, recordBeat, startMatch, sweepStalePlayers, type RoomPayload } from "@/lib/snelleZendeling/match";

// Samen spelen met Vliegende {gids} (LiveGame mode QUICK_MISSIONARY, zie
// QuickMissionaryMatch in schema.prisma). Deze module doet drie dingen:
//  1. de lobby: deelnemen, vrienden uitnodigen, starten (door de host);
//  2. tijdens de run: een klokijking voor de gezamenlijke tijdlijn, de
//     "ghosts" (positie van de anderen, puur visueel) en hartslagen;
//  3. het wegvallen van spelers die niets meer laten horen.
// Wat de uitslag bepaalt (dood, Genees, opgeven, einde van de run, laatste twee)
// staat NIET hier maar in src/lib/snelleZendeling/match.ts en runs.ts, in de
// database en onder een rijvergrendeling: deze module voegt daar niets aan toe
// en kan de uitslag dus niet beïnvloeden. Ghostposities zijn vluchtig en
// onbetrouwbaar (niet bewaard, niet gebruikt voor botsingen of score).
//
// Foutmeldingen gaan als i18n-sleutel naar de client (qm:error).

const SWEEP_INTERVAL_MS = 5_000;
const BEAT_FLUSH_MS = 1_000;
const GHOST_TICK_MS = 100;
/** Bij heel veel spelers dunnen we de ghostupdates uit; zo blijft de verbinding behapbaar zonder spelers te weigeren. */
const GHOST_TICK_LARGE_MS = 250;
const LARGE_ROOM = 30;
const ENDED_ROOM_TTL_MS = 10 * 60_000;

interface Member {
  userId: string;
  handle: string;
  socketIds: Set<string>;
}

interface Ghost {
  y: number;
  score: number;
  boost: boolean;
  dirty: boolean;
}

interface Room {
  code: string;
  gameId: string;
  hostId: string;
  status: "lobby" | "running" | "ended";
  matchId: string | null;
  members: Map<string, Member>;
  ghosts: Map<string, Ghost>;
  lastFlush: Map<string, number>;
  ghostTimer?: NodeJS.Timeout;
  pushTimer?: NodeJS.Timeout;
}

const rooms = new Map<string, Room>();
const loadingRooms = new Map<string, Promise<Room | string>>();
let io: SocketIOServer | null = null;
let sweeperStarted = false;

const channel = matchChannel;

// --- Laden ------------------------------------------------------------------------

async function loadRoom(code: string): Promise<Room | string> {
  const game = await prisma.liveGame.findUnique({
    where: { code },
    select: {
      id: true,
      hostId: true,
      mode: true,
      status: true,
      quickMissionaryMatch: { select: { id: true, status: true } },
      players: { select: { userId: true, user: { select: { handle: true } } } },
    },
  });
  if (!game || game.mode !== "QUICK_MISSIONARY") return "quickMissionary.together.errors.notFound";
  const match = game.quickMissionaryMatch;
  const room: Room = {
    code,
    gameId: game.id,
    hostId: game.hostId,
    status: match ? (match.status === "RUNNING" ? "running" : "ended") : game.status === "LOBBY" ? "lobby" : "ended",
    matchId: match?.id ?? null,
    members: new Map(game.players.map((p) => [p.userId, { userId: p.userId, handle: p.user.handle, socketIds: new Set<string>() }])),
    ghosts: new Map(),
    lastFlush: new Map(),
  };
  return room;
}

async function getRoom(code: string): Promise<Room | string> {
  const existing = rooms.get(code);
  if (existing) return existing;
  let pending = loadingRooms.get(code);
  if (!pending) {
    pending = loadRoom(code).then((result) => {
      if (typeof result !== "string") {
        rooms.set(code, result);
        if (result.status === "running") startGhostTimer(result);
      }
      return result;
    });
    loadingRooms.set(code, pending);
    pending.finally(() => loadingRooms.delete(code)).catch(() => {});
  }
  return pending;
}

/** De lobby is elders verwijderd (cancel_game in gameServer.ts). */
export function forgetQuickMissionaryRoom(code: string): void {
  const room = rooms.get(code);
  if (room) stopTimers(room);
  rooms.delete(code);
}

function stopGhostTimer(room: Room): void {
  if (room.ghostTimer) clearInterval(room.ghostTimer);
  room.ghostTimer = undefined;
}

function stopTimers(room: Room): void {
  stopGhostTimer(room);
  if (room.pushTimer) clearTimeout(room.pushTimer);
  room.pushTimer = undefined;
}

// --- Staat naar de clients ----------------------------------------------------------

async function buildPayload(room: Room): Promise<RoomPayload | null> {
  const game = await prisma.liveGame.findUnique({
    where: { id: room.gameId },
    select: { hostId: true, players: { select: { user: { select: { id: true, handle: true, discriminator: true } } } } },
  });
  if (!game) return null;
  const match = room.matchId ? await getMatchView(room.matchId) : null;
  const phase: RoomPayload["phase"] = match ? (match.status === "RUNNING" ? "running" : "ended") : "lobby";
  room.status = phase;
  if (phase === "ended") {
    // Alleen de ghosts stoppen: een wachtende push naar de hele room (die dit
    // einde aan iedereen meldt) mag hier niet door verdwijnen.
    stopGhostTimer(room);
    room.ghosts.clear();
    setTimeout(() => rooms.delete(room.code), ENDED_ROOM_TTL_MS).unref?.();
  }
  if (match) {
    // Alleen wie nog vliegt heeft een ghost.
    const flying = new Set(match.participants.filter((p) => p.state === "ACTIVE").map((p) => p.userId));
    for (const userId of [...room.ghosts.keys()]) if (!flying.has(userId)) room.ghosts.delete(userId);
  }
  return {
    phase,
    hostId: game.hostId,
    code: room.code,
    players: game.players.map((p) => p.user),
    match,
  };
}

async function pushRoom(room: Room, only?: Socket): Promise<void> {
  const payload = await buildPayload(room).catch(() => null);
  if (!payload) return;
  if (only) only.emit("qm:room", payload);
  else io?.to(channel(room.code)).emit("qm:room", payload);
}

/** Meerdere wijzigingen kort na elkaar geven één push, ook bij heel veel spelers. */
function schedulePush(room: Room): void {
  if (room.pushTimer) return;
  room.pushTimer = setTimeout(() => {
    room.pushTimer = undefined;
    void pushRoom(room);
  }, 120);
  room.pushTimer.unref?.();
}

function startGhostTimer(room: Room): void {
  if (room.ghostTimer) return;
  let lastTick = 0;
  room.ghostTimer = setInterval(() => {
    const now = Date.now();
    if (room.ghosts.size > LARGE_ROOM && now - lastTick < GHOST_TICK_LARGE_MS) return;
    lastTick = now;
    const updates: [string, number, number, number][] = [];
    for (const [userId, ghost] of room.ghosts) {
      if (!ghost.dirty) continue;
      ghost.dirty = false;
      updates.push([userId, Math.round(ghost.y * 10) / 10, ghost.score, ghost.boost ? 1 : 0]);
    }
    if (updates.length > 0) io?.to(channel(room.code)).volatile.emit("qm:ghosts", { t: now, g: updates });
  }, GHOST_TICK_MS);
  room.ghostTimer.unref?.();
}

// --- Wegvallen -----------------------------------------------------------------------

async function sweepAll(): Promise<void> {
  const running = await prisma.quickMissionaryMatch.findMany({ where: { status: "RUNNING" }, select: { id: true, liveGame: { select: { code: true } }, runs: { select: { userId: true } } } });
  for (const match of running) {
    const result = await sweepStalePlayers(match.id).catch(() => null);
    if (!result) continue;
    announceMatchChanged({ code: match.liveGame.code, endedFor: result.ended ? match.runs.map((run) => run.userId) : null });
  }
}

function startSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;
  // Na een herstart van de server geven we iedereen een verse wachttijd: de
  // clients verbinden vanzelf opnieuw en niemand valt af door ons eigen herstart.
  void prisma.quickMissionaryRun
    .updateMany({ where: { match: { status: "RUNNING" }, status: { not: "FINISHED" } }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
  const timer = setInterval(() => {
    sweepAll().catch(() => {});
  }, SWEEP_INTERVAL_MS);
  timer.unref?.();
  setMatchChangeListener((code) => {
    const room = rooms.get(code);
    if (room) schedulePush(room);
  });
}

// --- Handlers ------------------------------------------------------------------------

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function registerQuickMissionaryHandlers(server: SocketIOServer, socket: Socket, user: { id: string; handle: string; isAdmin?: boolean }): void {
  io = server;
  startSweeper();
  const fail = (key: string) => socket.emit("qm:error", { key });
  const current = (): Room | null => {
    const code = socket.data.qmCode as string | undefined;
    return code ? (rooms.get(code) ?? null) : null;
  };

  /** Hartslag + score naar de database, hooguit eens per seconde per speler. */
  const touch = (room: Room, score: number | null) => {
    if (!room.matchId || room.status !== "running") return;
    const now = Date.now();
    if (now - (room.lastFlush.get(user.id) ?? 0) < BEAT_FLUSH_MS) return;
    room.lastFlush.set(user.id, now);
    recordBeat(room.matchId, user.id, score).catch(() => {});
  };

  socket.on("qm:join", async ({ code }: { code?: unknown }) => {
    if (typeof code !== "string" || code.length > 16) return;
    const upper = code.toUpperCase();
    const result = await getRoom(upper).catch(() => "quickMissionary.together.errors.failed");
    if (typeof result === "string") return fail(result);
    const room = result;

    let member = room.members.get(user.id);
    if (!member) {
      // Instappen kan alleen in de lobby; een lopende run heeft vaste deelnemers.
      if (room.status !== "lobby") return fail("quickMissionary.together.errors.notParticipant");
      const invited =
        room.hostId === user.id ||
        (await prisma.liveGameInvite.findUnique({ where: { gameId_userId: { gameId: room.gameId, userId: user.id } } }).catch(() => null)) !== null;
      if (!invited) return fail("quickMissionary.together.errors.notInvited");
      if (!(await canUseQuickMissionary(user.id, user.isAdmin === true).catch(() => false))) return fail("quickMissionary.together.errors.unavailable");
      await prisma.liveGamePlayer
        .upsert({ where: { gameId_userId: { gameId: room.gameId, userId: user.id } }, create: { gameId: room.gameId, userId: user.id }, update: {} })
        .catch(() => {});
      member = { userId: user.id, handle: user.handle, socketIds: new Set() };
      room.members.set(user.id, member);
    }
    member.socketIds.add(socket.id);
    socket.data.qmCode = upper;
    socket.join(channel(upper));
    // Wie (opnieuw) verbindt krijgt de actuele stand; de rest alleen bij een wijziging.
    await pushRoom(room, socket);
    if (room.status === "lobby") schedulePush(room);
  });

  socket.on("qm:sync", async () => {
    const room = current();
    if (room) await pushRoom(room, socket);
  });

  // Klokijking: de client meet zelf heen-en-terugtijd en corrigeert zijn eigen klok
  // naar servertijd; de gezamenlijke tijdlijn loopt op servertijd.
  socket.on("qm:clock", (ack?: (result: { now: number }) => void) => {
    if (typeof ack === "function") ack({ now: Date.now() });
  });

  socket.on("qm:invite", async ({ toUserId }: { toUserId?: unknown }) => {
    const room = current();
    if (!room || room.status !== "lobby" || typeof toUserId !== "string" || !room.members.has(user.id)) return;
    const friendship = await prisma.friendship.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: user.id, receiverId: toUserId },
          { senderId: toUserId, receiverId: user.id },
        ],
      },
      select: { id: true },
    });
    if (!friendship) return;
    await prisma.liveGameInvite
      .upsert({ where: { gameId_userId: { gameId: room.gameId, userId: toUserId } }, create: { gameId: room.gameId, userId: toUserId }, update: {} })
      .catch(() => {});
    const recipient = await prisma.user.findUnique({ where: { id: toUserId }, select: { uiLanguage: true } });
    const label = (language: string | null | undefined) => getT(language)("quickMissionary.together.inviteLabel");
    io?.to(`user:${toUserId}`).emit("game_invite", {
      code: room.code,
      fromDisplayName: user.handle,
      fromUserId: user.id,
      gameLabel: label(recipient?.uiLanguage),
    });
    notifyGameInvite(toUserId, user.handle, () => label(recipient?.uiLanguage), room.code).catch(() => {});
  });

  socket.on("qm:start", async () => {
    const room = current();
    if (!room || room.hostId !== user.id || room.status !== "lobby") return;
    const result = await startMatch(room.gameId, user.id).catch(() => null);
    if (!result) return fail("quickMissionary.together.errors.failed");
    if (!result.ok) return fail(result.error === "TOO_FEW_PLAYERS" ? "quickMissionary.together.errors.tooFew" : "quickMissionary.together.errors.failed");
    room.status = "running";
    room.matchId = result.matchId;
    room.lastFlush.clear();
    startGhostTimer(room);

    // Uitgenodigden die nog niet meededen kunnen niet meer instappen: laat dat weten.
    const open = await prisma.liveGameInvite.findMany({ where: { gameId: room.gameId, userId: { notIn: result.userIds } }, select: { userId: true } }).catch(() => []);
    for (const invite of open) io?.to(`user:${invite.userId}`).emit("game_invite_revoked", { code: room.code });
    await removeNotificationsByUrl(open.map((invite) => invite.userId), `/live/${room.code}`).catch(() => {});
    await pushRoom(room);
  });

  socket.on("qm:leave", async () => {
    const room = current();
    // Alleen vóór de start; tijdens de run is het opgeven (finish-route), zodat de uitslag klopt.
    if (!room || room.status !== "lobby" || room.hostId === user.id) return;
    const member = room.members.get(user.id);
    room.members.delete(user.id);
    for (const socketId of member?.socketIds ?? []) {
      const s = io?.sockets.sockets.get(socketId);
      s?.leave(channel(room.code));
      if (s?.data.qmCode === room.code) s.data.qmCode = undefined;
    }
    await prisma.liveGamePlayer.deleteMany({ where: { gameId: room.gameId, userId: user.id } }).catch(() => {});
    io?.to(`user:${user.id}`).emit("game_left", { code: room.code });
    schedulePush(room);
  });

  // Positie van de eigen mascotte, voor de ghosts bij de anderen. Alleen visueel.
  socket.on("qm:pos", (data: { y?: unknown; score?: unknown; boost?: unknown }) => {
    const room = current();
    if (!room || room.status !== "running" || !room.members.has(user.id)) return;
    const y = finiteNumber(data?.y, -300, 1000);
    const score = finiteNumber(data?.score, 0, 10_000);
    if (y === null || score === null) return;
    room.ghosts.set(user.id, { y, score: Math.floor(score), boost: data.boost === true, dirty: true });
    touch(room, Math.floor(score));
  });

  // Teken van leven voor wie niet vliegt (Genees-vraag, "doorgaan").
  socket.on("qm:beat", () => {
    const room = current();
    if (!room || room.status !== "running" || !room.members.has(user.id)) return;
    touch(room, null);
  });

  socket.on("disconnect", () => {
    const room = current();
    const member = room?.members.get(user.id);
    if (!room || !member) return;
    member.socketIds.delete(socket.id);
    // Bewust geen directe eliminatie: een herverbinding binnen de wachttijd
    // (match.ts) verandert niets aan de stand.
    if (room.status === "lobby") schedulePush(room);
  });
}
