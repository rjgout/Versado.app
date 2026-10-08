import type { Server as SocketIOServer, Socket } from "socket.io";
import type { CourseType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { completeStudyRound } from "@/lib/streak";
import { notifyGameInvite, notifyNewAchievements, removeNotificationsByUrl } from "@/lib/notify";
import { getT } from "@/lib/i18n";
import { localizedCourse } from "@/lib/courseText";
import { loadStudyContent, loadStudyQuestions, publicQuestion, type StudyQuestion, type StudyUnitContent } from "@/lib/study/units";
import { buildStandings, scoreRound, type StudyAnswerRow, type StudyRoundResult } from "@/lib/study/scoring";
import { markChapterRead, markStepRead } from "@/lib/learning/contentProgress";

// Samen studeren (LiveGame mode STUDY, zie StudySession in schema.prisma).
// Anders dan de live-quiz (gameServer.ts) beantwoordt hier iedereen de
// vragen in eigen tempo: een stap start voor iedereen tegelijk, de server
// legt elk antwoord met tijdstip vast, en als iedereen die meedoet klaar is
// (of de host afrondt, of de ruime tijdslimiet verloopt) volgt de uitslag.
// Daarna kiest de host de volgende stap; de totaalstand groeit zolang er
// gespeeld wordt. Alles wat de stand bepaalt staat in de database, zodat een
// herstart van de server alleen een lopende stap vroegtijdig afrondt.
//
// Foutmeldingen gaan als i18n-sleutel naar de client (st:error), zodat
// iedereen ze in de eigen taal ziet.

const COUNTDOWN_MS = 3_000;
// Vangnet voor een stap waarin iemand nooit meer antwoordt (en ook niet
// wegvalt): ruim genoeg om rustig te lezen, zodat niemand opgejaagd wordt.
const SECONDS_PER_QUESTION = 90;
const MAX_GIVEN_ITEMS = 30;
const MAX_GIVEN_LENGTH = 300;

interface Member {
  userId: string;
  handle: string;
  socketIds: Set<string>;
}

interface ActiveRound {
  id: string;
  number: number;
  unitKey: string;
  label: string;
  phase: "READING" | "QUESTIONS";
  content: StudyUnitContent;
  questions: StudyQuestion[];
  /** Tijdstip waarop de vragen opengaan (na het aftellen). */
  startsAt: number | null;
  answers: Map<string, Map<number, { correct: boolean; at: number }>>;
  /** Wie er bij de start bij was; alleen zij spelen deze stap mee. */
  expected: Set<string>;
  timer?: NodeJS.Timeout;
}

interface CourseInfo {
  id: string;
  type: CourseType;
  podcastId: string | null;
  name: string;
  description: string | null;
  work: string | null;
}

interface Room {
  code: string;
  gameId: string;
  sessionId: string;
  hostId: string;
  course: CourseInfo;
  status: "open" | "ended";
  members: Map<string, Member>;
  round: ActiveRound | null;
  history: StudyRoundResult[][];
  lastResults: { number: number; label: string; results: StudyRoundResult[] } | null;
  /** Namen van iedereen die ooit meedeed, ook wie later vertrok (voor de stand). */
  handles: Map<string, string>;
  closing: boolean;
}

const rooms = new Map<string, Room>();
const loadingRooms = new Map<string, Promise<Room | string>>();
let io: SocketIOServer | null = null;

function channel(code: string) {
  return `study:${code}`;
}

function isOnline(room: Room, userId: string): boolean {
  return (room.members.get(userId)?.socketIds.size ?? 0) > 0;
}

// --- Laden ---------------------------------------------------------------------

async function loadRoom(code: string): Promise<Room | string> {
  const game = await prisma.liveGame.findUnique({
    where: { code },
    select: {
      id: true,
      hostId: true,
      mode: true,
      status: true,
      players: { select: { userId: true, user: { select: { handle: true } } } },
      studySession: {
        select: {
          id: true,
          course: { select: { id: true, type: true, podcastId: true, name: true, description: true, contentCollection: { select: { work: true } } } },
          rounds: {
            orderBy: { number: "asc" },
            select: {
              id: true,
              number: true,
              unitKey: true,
              unitLabel: true,
              questions: true,
              phase: true,
              startedAt: true,
              closedAt: true,
              answers: { select: { userId: true, index: true, correct: true, answeredAt: true, user: { select: { handle: true } } } },
            },
          },
        },
      },
    },
  });
  if (!game || game.mode !== "STUDY" || !game.studySession) return "study.errors.notFound";
  const session = game.studySession;

  const room: Room = {
    code,
    gameId: game.id,
    sessionId: session.id,
    hostId: game.hostId,
    course: { ...session.course, work: session.course.contentCollection.work },
    status: game.status === "FINISHED" ? "ended" : "open",
    members: new Map(game.players.map((p) => [p.userId, { userId: p.userId, handle: p.user.handle, socketIds: new Set<string>() }])),
    round: null,
    history: [],
    lastResults: null,
    handles: new Map(game.players.map((p) => [p.userId, p.user.handle])),
    closing: false,
  };

  for (const round of session.rounds) {
    for (const a of round.answers) room.handles.set(a.userId, a.user.handle);
    const questions = JSON.parse(round.questions) as StudyQuestion[];
    // Een leesfase heeft nog geen punten of antwoorden. Die laden we precies
    // terug, zodat een reconnect of serverherstart de groep niet terugstuurt
    // naar de stapkiezer.
    if (!round.closedAt && round.phase === "READING") {
      const content = await loadStudyContent(room.course, round.unitKey).catch(() => null);
      if (content) {
        room.round = {
          id: round.id,
          number: round.number,
          unitKey: round.unitKey,
          label: round.unitLabel,
          phase: "READING",
          content,
          questions,
          startsAt: null,
          answers: new Map(),
          expected: new Set(),
        };
        continue;
      }
    }
    // Een bestaande vraagronde wordt na een serverherstart net als voorheen
    // afgesloten met wat al beantwoord is.
    if (!round.closedAt) {
      await prisma.studyRound.update({ where: { id: round.id }, data: { closedAt: new Date() } }).catch(() => {});
      if (round.startedAt) await awardRound(questions.length, round.startedAt, round.answers, round.id).catch(() => {});
    }
    const results = scoreRound(questions.length, round.startedAt ?? new Date(), round.answers);
    room.history.push(results);
    room.lastResults = { number: round.number, label: round.unitLabel, results };
  }
  return room;
}

async function getRoom(code: string): Promise<Room | string> {
  const existing = rooms.get(code);
  if (existing) return existing;
  let pending = loadingRooms.get(code);
  if (!pending) {
    pending = loadRoom(code).then((result) => {
      if (typeof result !== "string") rooms.set(code, result);
      return result;
    });
    loadingRooms.set(code, pending);
    pending.finally(() => loadingRooms.delete(code)).catch(() => {});
  }
  return pending;
}

/** De sessie is elders verwijderd (bv. een lobby geannuleerd via cancel_game). */
export function forgetStudyRoom(code: string) {
  const room = rooms.get(code);
  if (room?.round?.timer) clearTimeout(room.round.timer);
  rooms.delete(code);
}

// --- Staat naar de clients -------------------------------------------------------

function progressOf(round: ActiveRound, total: number) {
  const finished = [...round.answers.entries()]
    .filter(([, answers]) => answers.size >= total)
    .map(([userId, answers]) => ({ userId, last: Math.max(...[...answers.values()].map((a) => a.at)) }))
    .sort((a, b) => a.last - b.last);
  return [...round.expected].map((userId) => {
    const answered = round.answers.get(userId)?.size ?? 0;
    const position = finished.findIndex((f) => f.userId === userId);
    return { userId, answered, finished: answered >= total, finishPosition: position >= 0 ? position + 1 : null };
  });
}

function stateFor(room: Room, userId: string) {
  const name = (id: string) => room.handles.get(id) ?? "?";
  const round = room.round;
  const total = round?.phase === "QUESTIONS" ? round.questions.length : 0;
  const standings = buildStandings(room.history).map((s) => ({ ...s, handle: name(s.userId) }));
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    courseId: room.course.id,
    members: [...room.members.values()].map((m) => ({ userId: m.userId, handle: m.handle, online: m.socketIds.size > 0 })),
    round: round
      ? {
          id: round.id,
          number: round.number,
          label: round.label,
          phase: round.phase,
          content: round.phase === "READING" ? round.content : null,
          total,
          startsInMs: round.startsAt ? Math.max(0, round.startsAt - Date.now()) : 0,
          participating: round.phase === "QUESTIONS" && round.expected.has(userId),
          questions: round.phase === "QUESTIONS" && round.expected.has(userId) ? round.questions.map(publicQuestion) : [],
          myAnswers: [...(round.answers.get(userId)?.entries() ?? [])].map(([index, a]) => ({ index, correct: a.correct })),
          progress: progressOf(round, total).map((p) => ({ ...p, handle: name(p.userId) })),
        }
      : null,
    lastResults: room.lastResults
      ? { ...room.lastResults, results: room.lastResults.results.map((r) => ({ ...r, handle: name(r.userId) })) }
      : null,
    standings,
    roundsPlayed: room.history.length,
  };
}

function broadcast(room: Room) {
  if (!io) return;
  for (const member of room.members.values()) {
    const state = stateFor(room, member.userId);
    for (const socketId of member.socketIds) io.sockets.sockets.get(socketId)?.emit("st:state", state);
  }
}

// --- Rondes ----------------------------------------------------------------------

async function awardRound(total: number, startedAt: Date, answers: StudyAnswerRow[], roundId: string) {
  const results = scoreRound(total, startedAt, answers);
  for (const r of results) {
    const outcome = await completeStudyRound(r.userId, r.correct, r.answered, total, r.rank === 1 && results.length > 1, `study:${roundId}`).catch(() => null);
    if (outcome && outcome.newAchievements.length > 0) notifyNewAchievements(r.userId, outcome.newAchievements).catch(() => {});
  }
  return results;
}

async function closeRound(room: Room) {
  const round = room.round;
  if (!round || round.phase !== "QUESTIONS" || round.startsAt === null || room.closing) return;
  room.closing = true;
  if (round.timer) clearTimeout(round.timer);
  try {
    const startedAt = new Date(round.startsAt);
    const answers: StudyAnswerRow[] = [];
    for (const [userId, perIndex] of round.answers) {
      for (const [index, a] of perIndex) answers.push({ userId, index, correct: a.correct, answeredAt: new Date(a.at) });
    }
    await prisma.studyRound.update({ where: { id: round.id }, data: { closedAt: new Date() } }).catch(() => {});
    const results = scoreRound(round.questions.length, startedAt, answers);
    room.history.push(results);
    room.lastResults = { number: round.number, label: round.label, results };
    room.round = null;
    broadcast(room);
    // XP en reeks na het tonen van de uitslag: dat mag even duren.
    await awardRound(round.questions.length, startedAt, answers, round.id).catch(() => {});
    for (const r of results) io?.to(`user:${r.userId}`).emit("st:awarded", { code: room.code });
  } finally {
    room.closing = false;
  }
}

/** Klaar als iedereen die meedoet en nog verbonden is alles beantwoord heeft. */
function maybeClose(room: Room) {
  const round = room.round;
  if (!round || round.phase !== "QUESTIONS") return;
  const total = round.questions.length;
  const stillPlaying = [...round.expected].filter((id) => isOnline(room, id));
  const anyAnswer = round.answers.size > 0;
  if (anyAnswer && stillPlaying.every((id) => (round.answers.get(id)?.size ?? 0) >= total)) {
    closeRound(room).catch(() => {});
  }
}

async function startRound(room: Room, userId: string, unitKey: string): Promise<string | null> {
  if (room.status !== "open") return "study.errors.notFound";
  if (room.hostId !== userId || room.round || room.closing) return null;
  const host = await prisma.user.findUnique({ where: { id: userId }, select: { uiLanguage: true } });
  const [loaded, content] = await Promise.all([
    loadStudyQuestions(room.course, unitKey, getT(host?.uiLanguage)),
    loadStudyContent(room.course, unitKey),
  ]);
  if (!loaded || loaded.questions.length === 0 || !content) return "study.errors.noQuestions";
  if (room.round) return null; // intussen al gestart (dubbelklik)

  const number = room.history.length + 1;
  const row = await prisma.studyRound.create({
    data: {
      sessionId: room.sessionId,
      number,
      unitKey,
      unitLabel: loaded.label,
      questions: JSON.stringify(loaded.questions),
      phase: "READING",
    },
  });
  if (room.history.length === 0) {
    await prisma.liveGame.update({ where: { id: room.gameId }, data: { status: "IN_PROGRESS" } }).catch(() => {});
  }
  room.round = {
    id: row.id,
    number,
    unitKey,
    label: loaded.label,
    phase: "READING",
    content,
    questions: loaded.questions,
    startsAt: null,
    answers: new Map(),
    expected: new Set(),
  };
  broadcast(room);
  return null;
}

async function recordSharedReading(round: ActiveRound, userIds: Set<string>) {
  const content = round.content;
  if (content.kind !== "scripture") return;
  const [, unitId] = round.unitKey.split(":");
  if (!unitId) return;
  await Promise.all(
    [...userIds].map(async (userId) => {
      // Een leesles telt tot en met het eindvers; een hoofdstukstap is het
      // hele hoofdstuk. Beide gebruiken precies dezelfde centrale bron als
      // de individuele leesroutes en kennen nooit XP of een reeks toe.
      if (round.unitKey.startsWith("rl:")) await markStepRead(prisma, userId, unitId);
      else await markChapterRead(userId, content.chapterId);
    })
  ).catch(() => {});
}

async function startQuestions(room: Room, userId: string, recordReading: boolean) {
  const round = room.round;
  if (!round || round.phase !== "READING" || room.hostId !== userId || room.closing) return;
  const expected = new Set([...room.members.values()].filter((member) => member.socketIds.size > 0).map((member) => member.userId));
  const startsAt = Date.now() + COUNTDOWN_MS;
  await prisma.studyRound
    .update({ where: { id: round.id }, data: { phase: "QUESTIONS", startedAt: new Date(startsAt) } })
    .catch(() => {});
  if (recordReading) await recordSharedReading(round, expected);
  round.phase = "QUESTIONS";
  round.startsAt = startsAt;
  round.expected = expected;
  round.timer = setTimeout(() => closeRound(room).catch(() => {}), COUNTDOWN_MS + round.questions.length * SECONDS_PER_QUESTION * 1000);
  broadcast(room);
}

async function endSession(room: Room) {
  if (room.status === "ended") return;
  if (room.round?.phase === "QUESTIONS") await closeRound(room);
  if (room.round?.phase === "READING") {
    await prisma.studyRound.delete({ where: { id: room.round.id } }).catch(() => {});
    room.round = null;
  }
  const invites = await prisma.liveGameInvite.findMany({ where: { gameId: room.gameId }, select: { userId: true } }).catch(() => []);
  await removeNotificationsByUrl(
    invites.map((i) => i.userId),
    `/live/${room.code}`
  ).catch(() => {});

  if (room.history.length === 0) {
    // Nog niets gespeeld: net als een geannuleerde lobby helemaal weg.
    await prisma.liveGame.delete({ where: { id: room.gameId } }).catch(() => {});
    for (const id of new Set([...room.members.keys(), ...invites.map((i) => i.userId)])) io?.to(`user:${id}`).emit("game_cancelled", { code: room.code });
    rooms.delete(room.code);
    return;
  }
  room.status = "ended";
  await prisma.liveGame.update({ where: { id: room.gameId }, data: { status: "FINISHED" } }).catch(() => {});
  broadcast(room);
  for (const id of room.members.keys()) io?.to(`user:${id}`).emit("game_left", { code: room.code });
  setTimeout(() => rooms.delete(room.code), 10 * 60_000);
}

// --- Handlers --------------------------------------------------------------------

export function registerStudyHandlers(server: SocketIOServer, socket: Socket, user: { id: string; handle: string }) {
  io = server;
  const fail = (key: string) => socket.emit("st:error", { key });
  const current = (): Room | null => {
    const code = socket.data.studyCode as string | undefined;
    return code ? (rooms.get(code) ?? null) : null;
  };

  socket.on("st:join", async ({ code }: { code?: unknown }) => {
    if (typeof code !== "string" || code.length > 16) return;
    const upper = code.toUpperCase();
    const result = await getRoom(upper).catch(() => "study.errors.failed");
    if (typeof result === "string") return fail(result);
    const room = result;

    let member = room.members.get(user.id);
    if (!member) {
      if (room.status !== "open") return fail("study.errors.notFound");
      const invited =
        room.hostId === user.id ||
        (await prisma.liveGameInvite.findUnique({ where: { gameId_userId: { gameId: room.gameId, userId: user.id } } }).catch(() => null)) !== null;
      if (!invited) return fail("study.errors.notInvited");
      await prisma.liveGamePlayer
        .upsert({ where: { gameId_userId: { gameId: room.gameId, userId: user.id } }, create: { gameId: room.gameId, userId: user.id }, update: {} })
        .catch(() => {});
      member = { userId: user.id, handle: user.handle, socketIds: new Set() };
      room.members.set(user.id, member);
      room.handles.set(user.id, user.handle);
    }
    member.socketIds.add(socket.id);
    socket.data.studyCode = upper;
    socket.join(channel(upper));
    broadcast(room);
  });

  socket.on("st:invite", async ({ toUserId }: { toUserId?: unknown }) => {
    const room = current();
    if (!room || room.status !== "open" || typeof toUserId !== "string" || !room.members.has(user.id)) return;
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
    const label = (language: string | null | undefined) =>
      getT(language)("study.inviteLabel", { course: localizedCourse(room.course, language).name });
    io?.to(`user:${toUserId}`).emit("game_invite", {
      code: room.code,
      fromDisplayName: user.handle,
      fromUserId: user.id,
      gameLabel: label(recipient?.uiLanguage),
    });
    notifyGameInvite(toUserId, user.handle, () => label(recipient?.uiLanguage), room.code).catch(() => {});
  });

  socket.on("st:start_round", async ({ unitKey }: { unitKey?: unknown }) => {
    const room = current();
    if (!room || typeof unitKey !== "string" || unitKey.length > 120) return;
    const error = await startRound(room, user.id, unitKey).catch(() => "study.errors.failed");
    if (error) fail(error);
  });

  socket.on("st:begin_questions", () => {
    const room = current();
    if (!room) return;
    startQuestions(room, user.id, true).catch(() => {});
  });

  socket.on("st:skip_reading", () => {
    const room = current();
    if (!room) return;
    startQuestions(room, user.id, false).catch(() => {});
  });

  socket.on(
    "st:answer",
    async (
      { roundId, index, given }: { roundId?: unknown; index?: unknown; given?: unknown },
      ack?: (result: { ok: boolean; correct?: boolean; correctAnswer?: string[] }) => void
    ) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const room = current();
      const round = room?.round;
      if (!room || !round || round.phase !== "QUESTIONS" || round.id !== roundId || !round.expected.has(user.id)) return reply({ ok: false });
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= round.questions.length) return reply({ ok: false });
      if (!Array.isArray(given) || given.length === 0 || given.length > MAX_GIVEN_ITEMS) return reply({ ok: false });
      if (!given.every((g) => typeof g === "string" && g.length <= MAX_GIVEN_LENGTH)) return reply({ ok: false });
      // Een kleine marge voor klokverschil; eerder antwoorden kan niet.
      if (round.startsAt === null || Date.now() < round.startsAt - 500) return reply({ ok: false });

      const question = round.questions[index];
      const mine = round.answers.get(user.id) ?? new Map<number, { correct: boolean; at: number }>();
      const earlier = mine.get(index);
      if (earlier) return reply({ ok: true, correct: earlier.correct, correctAnswer: question.answers });

      const correct = isExerciseCorrect(question.type, given as string[], question.answers);
      const at = Date.now();
      mine.set(index, { correct, at });
      round.answers.set(user.id, mine);
      await prisma.studyAnswer
        .create({ data: { roundId: round.id, userId: user.id, index, correct, answeredAt: new Date(at) } })
        .catch(() => {});
      reply({ ok: true, correct, correctAnswer: question.answers });
      broadcast(room);
      maybeClose(room);
    }
  );

  socket.on("st:close_round", () => {
    const room = current();
    if (!room || room.hostId !== user.id || !room.round || room.round.phase !== "QUESTIONS") return;
    closeRound(room).catch(() => {});
  });

  socket.on("st:leave", async () => {
    const room = current();
    if (!room || room.hostId === user.id) return;
    const member = room.members.get(user.id);
    room.members.delete(user.id);
    room.round?.expected.delete(user.id);
    for (const socketId of member?.socketIds ?? []) {
      const s = io?.sockets.sockets.get(socketId);
      s?.leave(channel(room.code));
      if (s?.data.studyCode === room.code) s.data.studyCode = undefined;
    }
    await prisma.liveGamePlayer.deleteMany({ where: { gameId: room.gameId, userId: user.id } }).catch(() => {});
    io?.to(`user:${user.id}`).emit("game_left", { code: room.code });
    broadcast(room);
    maybeClose(room);
  });

  socket.on("st:end", () => {
    const room = current();
    if (!room || room.hostId !== user.id) return;
    endSession(room).catch(() => {});
  });

  socket.on("disconnect", () => {
    const room = current();
    const member = room?.members.get(user.id);
    if (!room || !member) return;
    member.socketIds.delete(socket.id);
    broadcast(room);
    maybeClose(room);
  });
}
