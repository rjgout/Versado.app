import type { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { randomUUID } from "crypto";
import type { ChapterGuessLevel, FamilyGameDiceMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth";
import { isLiveTopic, topicRoom } from "@/lib/data/scopes";
import { parseCookieHeader } from "@/lib/parseCookieHeader";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { completeLiveQuiz, completeChapterGuess } from "@/lib/streak";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { notifyGameInvite, notifyNewAchievements, removeNotificationsByUrl } from "@/lib/notify";
import { setRealtimeServer } from "@/lib/realtime";
import { getT } from "@/lib/i18n";
import type { TFunction } from "@/lib/i18n/core";
import {
  announceCameOnline,
  broadcastPresenceUpdate,
  sendFriendStatusesToUser,
  setCurrentActivity,
  clearCurrentActivity,
  getAcceptedFriendIds,
} from "@/lib/presence";
import { generateChapterGuessQuestions, labelsFor, computeHintEffect, type LiveQuestionSeed, type ChapterLabel } from "@/lib/chapterGuess";
import {
  BOARD,
  finishIndexFor,
  pickExerciseCard,
  pickWhereInBookCard,
  explanationForExercise,
  checkExerciseAnswer,
  nextDifficulty,
  EVENT_CARDS,
  type BoardTile,
  type FamilyCard,
  type FamilyDifficulty,
} from "@/lib/familyGame";
import { forgetAlleskennerRoom, registerAlleskennerHandlers } from "@/server/alleskenner";
import { forgetStudyRoom, registerStudyHandlers } from "@/server/study";
import { forgetQuickMissionaryRoom, registerQuickMissionaryHandlers } from "@/server/quickMissionary";

const EXERCISES_TIME_MS = 20_000;
// "Raad het hoofdstuk" krijgt bewust ruim meer tijd (1 minuut, zoals
// gevraagd) dan de bestaande oefeningen-race: je moet eerst het introvers
// lezen vóór je kan antwoorden, dat kost meer tijd dan een invuloefening.
const CHAPTER_GUESS_TIME_MS = 60_000;
const REVEAL_PAUSE_MS = 3_500;
// Punten per goed kennisvraag/vul-aan/waar-in-boek-antwoord — bewust een vast
// bedrag (geen tijdsdruk-bonus zoals bij EXERCISES/CHAPTER_GUESS): dit is een
// gezinsspel voor aan tafel, geen race tegen de klok. Gebeurteniskaarten
// geven er een kleine, losse variatie bovenop (zie EVENT_CARDS).
const FAMILY_CORRECT_POINTS = 10;

type RoomMode = "EXERCISES" | "CHAPTER_GUESS" | "FAMILY_GAME";

interface GameExercise {
  id: string;
  type: "FILL_BLANK" | "WORD_BANK" | "TRUE_FALSE" | "MULTIPLE_CHOICE" | "SEQUENCE";
  verseRef: string;
  prompt: string;
  answers: string[];
  wordBank?: string[];
  options?: string[];
}

interface RoomPlayer {
  userId: string;
  displayName: string;
  socketIds: Set<string>;
  score: number;
  correctCount: number;
  answeredAt?: number;
  given?: string[];
  correct?: boolean;
  // Alleen relevant bij mode CHAPTER_GUESS. Hints zelf gaan via het gedeelde
  // User.hintBalance (zie src/lib/shop.ts) — hier alleen bijgehouden of
  // deze speler al een hint gebruikt heeft voor de huidige vraag.
  hintUsedThisQuestion: boolean;

  // Alleen relevant bij mode FAMILY_GAME — hieronder. Gasten bestaan alleen
  // in dit in-memory record (userId is dan een synthetisch "guest:<id>",
  // nooit een echte User-rij en dus ook nooit een LiveGamePlayer-rij) en
  // hebben per definitie geen eigen socket: hun beurt komt altijd binnen via
  // het socket van de host (zie canActFor hieronder). Een echt account dat
  // vanaf zijn eigen apparaat meedoet, joint zoals gewoonlijk via join_game
  // en heeft dus wél zijn eigen socketIds-invoer.
  isGuest?: boolean;
  position?: number;
  streak?: number; // opeenvolgende goede antwoorden, voor adaptieve moeilijkheid — reset bij een fout antwoord
}

interface RoomState {
  id: string;
  code: string;
  hostId: string;
  status: "LOBBY" | "IN_PROGRESS" | "FINISHED";
  mode: RoomMode;
  timeLimitMs: number;

  // EXERCISES
  chapterId: string | null;
  exercises: GameExercise[];

  // CHAPTER_GUESS
  level: ChapterGuessLevel | null;
  cgQuestions: LiveQuestionSeed[];
  cgChapterLabels: Map<string, ChapterLabel>;

  questionIndex: number;
  questionStartedAt: number;
  players: Map<string, RoomPlayer>;
  timer?: NodeJS.Timeout;
  // Gezet zodra iemand opgeeft (alleen relevant met vrienden/live) — de
  // tegenstander(s) winnen dan altijd, los van de stand op dat moment.
  forfeitedBy?: string;

  // FAMILY_GAME — het bord staat vast (zie src/lib/familyGame.ts), alleen
  // finishIndex verschilt per gekozen speelduur. turnOrder bevat zowel
  // accounts als gasten, in de volgorde waarin ze zijn toegevoegd; het spel
  // eindigt zodra de HUIDIGE speler de finish bereikt of passeert (een
  // "eerste over de streep beëindigt het spel voor iedereen"-race — wie
  // wint wordt daarna over punten bepaald, niet over bordpositie, zie
  // finishFamilyGame). pendingTile bewaart wat er server-side nodig is om
  // het openstaande antwoord/de keuze zo meteen te kunnen valideren, zonder
  // dat de client ooit het juiste antwoord te zien krijgt.
  // Optioneel (i.p.v. voor elke modus een neutrale default te moeten
  // meegeven zoals bij chapterId/level hierboven) — alleen FAMILY_GAME-
  // rooms vullen deze, en alle code die ze leest zit ook alleen in het
  // FAMILY_GAME-pad hieronder.
  board?: BoardTile[];
  finishIndex?: number;
  diceMode?: FamilyGameDiceMode | null;
  turnOrder?: string[];
  currentTurnIndex?: number;
  pendingTile?:
    | { kind: "KNOWLEDGE" | "FILL_IN"; exerciseId: string; playerId: string }
    | { kind: "WHERE_IN_BOOK"; correctChapterId: string; playerId: string }
    | { kind: "EVENT"; cardSlug: string; playerId: string }
    | null;
}

const rooms = new Map<string, RoomState>();
let ioInstance: SocketIOServer | null = null;

export function getIO() {
  return ioInstance;
}

function totalQuestions(room: RoomState): number {
  return room.mode === "EXERCISES" ? room.exercises.length : room.cgQuestions.length;
}

function collectChapterIds(questions: LiveQuestionSeed[]): string[] {
  const ids = new Set<string>();
  for (const q of questions) {
    ids.add(q.chapterId);
    q.optionIds?.forEach((id) => ids.add(id));
  }
  return [...ids];
}

async function authenticateSocket(socket: Socket) {
  const cookies = parseCookieHeader(socket.handshake.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = await verifySessionToken(token);
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
}

function serializePlayers(room: RoomState) {
  return [...room.players.values()]
    .map((p) => ({ userId: p.userId, displayName: p.displayName, score: p.score, isGuest: p.isGuest ?? false, position: p.position ?? 0 }))
    .sort((a, b) => b.score - a.score);
}

function sanitizeExercise(ex: GameExercise) {
  return {
    id: ex.id,
    type: ex.type,
    verseRef: ex.verseRef,
    prompt: ex.prompt,
    blanks: ex.answers.length,
    wordBank: ex.wordBank,
    options: ex.options,
  };
}

async function loadExercises(chapterId: string): Promise<GameExercise[]> {
  const rows = await prisma.exercise.findMany({
    where: { chapterId, status: "APPROVED" },
    orderBy: { order: "asc" },
    include: { options: { orderBy: { order: "asc" } } },
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type as "FILL_BLANK" | "WORD_BANK" | "TRUE_FALSE" | "MULTIPLE_CHOICE" | "SEQUENCE",
    verseRef: r.verseRef,
    prompt: r.prompt,
    answers: JSON.parse(r.answers) as string[],
    wordBank: r.wordBank ? (JSON.parse(r.wordBank) as string[]) : undefined,
    options: r.options.length > 0 ? r.options.map((o) => o.label) : undefined,
  }));
}

function liveGameLabel(game: { mode: string; chapter?: { number: number; book: { name: string } } | null }, t: TFunction): string {
  if (game.mode === "CHAPTER_GUESS") return t("pages.chapterGuess");
  if (game.mode === "FAMILY_GAME") return t("pages.familyNight");
  if (game.mode === "ALLESKENNER") return t("pages.alleskenner");
  if (game.mode === "QUICK_MISSIONARY") return t("quickMissionary.together.inviteLabel");
  return game.chapter ? `${game.chapter.book.name} ${game.chapter.number}` : t("notify.aLiveGame");
}

// Uitgenodigden die nog niet zijn toegetreden laten weten dat de uitnodiging
// vervalt (host annuleert of start zonder hen), zodat de melding en de
// gloeiende regel bij Spelen meteen verdwijnen.
async function revokeOpenInvites(code: string): Promise<void> {
  const game = await prisma.liveGame.findUnique({
    where: { code },
    select: { invites: { select: { userId: true } }, players: { select: { userId: true } } },
  });
  if (!game) return;
  const joined = new Set(game.players.map((p) => p.userId));
  for (const invite of game.invites) {
    if (!joined.has(invite.userId)) ioInstance?.to(`user:${invite.userId}`).emit("game_invite_revoked", { code });
  }
  // Gestart of geannuleerd: de uitnodiging in het meldingencentrum is niet meer te gebruiken.
  await removeNotificationsByUrl(game.invites.map((i) => i.userId), `/live/${code}`).catch(() => {});
}

function lobbyPayload(room: RoomState) {
  return {
    hostId: room.hostId,
    status: room.status,
    mode: room.mode,
    level: room.level,
    diceMode: room.diceMode,
    players: serializePlayers(room),
  };
}

function broadcastLobby(room: RoomState) {
  ioInstance?.to(room.code).emit("lobby_update", lobbyPayload(room));
}

// Stuurt een net (opnieuw) verbonden socket de huidige staat van een spel dat
// al bezig is — nodig omdat join_game daar verder geen normale broadcast voor
// stuurt (die zou voor de andere spelers alleen maar ruis zijn: een nieuwe
// vraag/beurt terwijl er niks veranderd is). Zonder dit bleef een speler die
// wegnavigeerde en terugkwam voor altijd op "Dit spel is al begonnen." hangen
// (zie join_game hieronder), met een spel dat voor de anderen eindeloos
// "open" bleef staan.
function resyncSocket(socket: Socket, room: RoomState) {
  socket.emit("lobby_update", lobbyPayload(room));

  if (room.status === "FINISHED") {
    socket.emit("game_finished", { scoreboard: serializePlayers(room), forfeitedBy: room.forfeitedBy });
    return;
  }
  if (room.status !== "IN_PROGRESS") return;

  if (room.mode === "FAMILY_GAME") {
    socket.emit("family_game_started", {
      board: room.board,
      finishIndex: room.finishIndex,
      diceMode: room.diceMode,
      turnOrder: room.turnOrder,
      scoreboard: serializePlayers(room),
    });
    // Een openstaande vraag/gebeurtenis leefde alleen in de React-state van de
    // pagina die nu net opnieuw is gemount — die kaart is dus sowieso weg. Als
    // deze socket namens de wachtende speler mag handelen (zichzelf, of de
    // host namens een gast), slaan we die beurt over i.p.v. het spel voor
    // iedereen te laten vastlopen (er is bewust geen aparte beurt-timer voor
    // dit spel, zie de sessieafspraak daarover).
    if (room.pendingTile && canActFor(room, socket, room.pendingTile.playerId)) {
      room.pendingTile = null;
      advanceFamilyTurn(room);
    } else {
      socket.emit("family_turn", { currentPlayerId: currentFamilyPlayerId(room), scoreboard: serializePlayers(room) });
    }
    return;
  }

  const total = totalQuestions(room);
  if (room.questionIndex >= total) return; // staat op het punt af te ronden
  const remaining = Math.max(0, room.timeLimitMs - (Date.now() - room.questionStartedAt));
  if (room.mode === "EXERCISES") {
    const exercise = room.exercises[room.questionIndex];
    socket.emit("question", { mode: "EXERCISES", index: room.questionIndex, total, timeLimitMs: remaining, ...sanitizeExercise(exercise) });
  } else {
    const q = room.cgQuestions[room.questionIndex];
    const options = q.optionIds?.map((id) => ({ id, label: room.cgChapterLabels.get(id)?.label ?? "?" }));
    socket.emit("question", { mode: "CHAPTER_GUESS", index: room.questionIndex, total, timeLimitMs: remaining, introText: q.introText, introAudio: q.introAudio, options });
  }
}

function askQuestion(room: RoomState) {
  const total = totalQuestions(room);
  if (room.questionIndex >= total) {
    finishGame(room);
    return;
  }
  for (const p of room.players.values()) {
    p.answeredAt = undefined;
    p.given = undefined;
    p.correct = undefined;
    p.hintUsedThisQuestion = false;
  }
  room.questionStartedAt = Date.now();

  if (room.mode === "EXERCISES") {
    const exercise = room.exercises[room.questionIndex];
    ioInstance?.to(room.code).emit("question", {
      mode: "EXERCISES",
      index: room.questionIndex,
      total,
      timeLimitMs: room.timeLimitMs,
      ...sanitizeExercise(exercise),
    });
  } else {
    const q = room.cgQuestions[room.questionIndex];
    const options = q.optionIds?.map((id) => ({ id, label: room.cgChapterLabels.get(id)?.label ?? "?" }));
    ioInstance?.to(room.code).emit("question", {
      mode: "CHAPTER_GUESS",
      index: room.questionIndex,
      total,
      timeLimitMs: room.timeLimitMs,
      introText: q.introText,
      introAudio: q.introAudio,
      options,
    });
  }

  room.timer = setTimeout(() => revealAndAdvance(room), room.timeLimitMs);
}

function allAnswered(room: RoomState) {
  return [...room.players.values()].every((p) => p.answeredAt !== undefined);
}

function revealAndAdvance(room: RoomState) {
  if (room.timer) clearTimeout(room.timer);
  const total = totalQuestions(room);

  let correctAnswer: string[];
  let correctChapterLabel: string | undefined;
  if (room.mode === "EXERCISES") {
    correctAnswer = room.exercises[room.questionIndex].answers;
  } else {
    const q = room.cgQuestions[room.questionIndex];
    correctAnswer = [q.chapterId];
    correctChapterLabel = room.cgChapterLabels.get(q.chapterId)?.label;
  }

  ioInstance?.to(room.code).emit("reveal", {
    index: room.questionIndex,
    correctAnswer,
    correctChapterLabel,
    scoreboard: serializePlayers(room),
  });

  room.questionIndex += 1;
  room.timer = setTimeout(() => {
    if (room.questionIndex >= total) {
      finishGame(room);
    } else {
      askQuestion(room);
    }
  }, REVEAL_PAUSE_MS);
}

async function finishGame(room: RoomState) {
  if (room.timer) clearTimeout(room.timer);
  if (room.status === "FINISHED") return; // al afgerond (bv. dubbele opgave-klik)
  room.status = "FINISHED";
  ioInstance?.to(room.code).emit("game_finished", { scoreboard: serializePlayers(room), forfeitedBy: room.forfeitedBy });
  await prisma.liveGame.update({ where: { code: room.code }, data: { status: "FINISHED" } }).catch(() => {});

  if (room.mode === "EXERCISES") {
    const maxScore = Math.max(0, ...[...room.players.values()].map((p) => p.score));
    for (const p of room.players.values()) {
      await prisma.liveGamePlayer
        .update({ where: { gameId_userId: { gameId: room.id, userId: p.userId } }, data: { score: p.score } })
        .catch(() => {});

      const percent = room.exercises.length === 0 ? 0 : Math.round((p.correctCount / room.exercises.length) * 100);
      const xp = Math.round(p.score / 5);
      const won = maxScore > 0 && p.score === maxScore;
      // Altijd aanroepen, ook bij xp === 0 (verloren met score 0): meespelen
      // telt als vandaag gestudeerd, net als bij CHAPTER_GUESS hieronder.
      // completeLiveQuiz/awardXp behandelen xp = 0 zelf al als no-op voor de
      // XP-boekhouding.
      await completeLiveQuiz(p.userId, room.chapterId!, percent, xp, won, `live:${room.id}`).catch(() => {});
    }
  } else if (room.mode === "CHAPTER_GUESS") {
    const total = room.cgQuestions.length;
    for (const p of room.players.values()) {
      await prisma.liveGamePlayer
        .update({ where: { gameId_userId: { gameId: room.id, userId: p.userId } }, data: { score: p.score } })
        .catch(() => {});
      await completeChapterGuess(p.userId, p.correctCount, total, room.level ?? undefined, `live:${room.id}`).catch(() => {});
    }
  } else {
    // FAMILY_GAME: bewust GEEN XP/streak — dit spel moet op zichzelf leuk
    // zijn, niet als omweg om XP te farmen (zie de sessieafspraak). Gasten
    // hebben nooit een LiveGamePlayer-rij (geen account, dus geen FK
    // mogelijk) en slaan deze update dus over; voor accounts (host, en
    // eventuele vrienden die vanaf hun eigen apparaat meespeelden) wordt
    // alleen de éénmalige, XP-loze "Gezinsavond"-prestatie gecontroleerd.
    for (const p of room.players.values()) {
      if (p.isGuest) continue;
      await prisma.liveGamePlayer
        .update({ where: { gameId_userId: { gameId: room.id, userId: p.userId } }, data: { score: p.score } })
        .catch(() => {});
      const newAchievements = await prisma.$transaction((tx) => checkAndAwardAchievements(tx, p.userId)).catch(() => []);
      if (newAchievements.length > 0) notifyNewAchievements(p.userId, newAchievements).catch(() => {});
    }
  }
  setTimeout(() => rooms.delete(room.code), 5 * 60_000);
}

function registerAnswer(room: RoomState, userId: string, given: string[]) {
  const player = room.players.get(userId);
  if (!player || player.answeredAt !== undefined) return;

  let correct: boolean;
  if (room.mode === "EXERCISES") {
    const exercise = room.exercises[room.questionIndex];
    if (!exercise) return;
    correct = isExerciseCorrect(exercise.type, given, exercise.answers);
  } else {
    const question = room.cgQuestions[room.questionIndex];
    if (!question) return;
    correct = given[0] === question.chapterId;
  }

  const elapsed = Date.now() - room.questionStartedAt;
  const remainingFraction = Math.max(0, 1 - elapsed / room.timeLimitMs);
  const points = correct ? Math.round(50 + 50 * remainingFraction) : 0;

  player.answeredAt = Date.now();
  player.given = given;
  player.correct = correct;
  player.score += points;
  if (correct) {
    player.correctCount += 1;
    // Net als bij het alleen-spelen-spel: geen nieuwe hints te verdienen op
    // EXPERT, daar mogen ze toch niet gebruikt worden. Rechtstreeks naar het
    // gedeelde User.hintBalance (zie src/lib/shop.ts) i.p.v. een los
    // per-partij tegoed, zodat dit overal hetzelfde getal blijft — synchroon
    // wegschrijven kan hier niet (registerAnswer is niet async), dus "fire
    // and forget" net als de andere niet-kritieke schrijfacties in dit bestand.
    if (room.mode === "CHAPTER_GUESS" && room.level !== "EXPERT" && !player.isGuest) {
      prisma.user.update({ where: { id: player.userId }, data: { hintBalance: { increment: 1 } } }).catch(() => {});
    }
  }

  ioInstance?.to(room.code).emit("answer_received", {
    userId,
    total: room.players.size,
    answered: [...room.players.values()].filter((p) => p.answeredAt !== undefined).length,
  });

  // Iedereen beantwoord? Dan meteen door, ook als de tijd nog niet om is
  // (net zoals bij de bestaande oefeningen-race).
  if (allAnswered(room)) {
    revealAndAdvance(room);
  }
}

// --- FAMILY_GAME ----------------------------------------------------------
//
// Bewust geen tijdslimiet per beurt (in tegenstelling tot EXERCISES/
// CHAPTER_GUESS hierboven) — dit is een rustig gezinsspel aan tafel, geen
// race tegen de klok. Eén speler tegelijk is aan de beurt (turnOrder); een
// gast bestaat alleen in dit geheugen en heeft nooit een eigen socket, dus
// diens beurt komt altijd binnen via het socket van de host.

function currentFamilyPlayerId(room: RoomState): string | null {
  return room.turnOrder![room.currentTurnIndex!] ?? null;
}

// Mag dit socket een actie insturen namens playerId? Alleen de speler zelf
// (een echt, apart ingelogd account) of — voor een gast, die geen eigen
// socket heeft — de host, die de gast fysiek naast zich heeft zitten.
function canActFor(room: RoomState, socket: Socket, playerId: string): boolean {
  const player = room.players.get(playerId);
  if (!player) return false;
  if (player.isGuest) return socket.data.userId === room.hostId;
  return socket.data.userId === playerId;
}

function broadcastFamilyTurn(room: RoomState) {
  ioInstance?.to(room.code).emit("family_turn", {
    currentPlayerId: currentFamilyPlayerId(room),
    scoreboard: serializePlayers(room),
  });
}

async function startFamilyGame(room: RoomState) {
  room.status = "IN_PROGRESS";
  await prisma.liveGame.update({ where: { code: room.code }, data: { status: "IN_PROGRESS" } });
  revokeOpenInvites(room.code).catch(() => {});
  ioInstance?.to(room.code).emit("family_game_started", {
    board: room.board,
    finishIndex: room.finishIndex,
    diceMode: room.diceMode,
    turnOrder: room.turnOrder,
    scoreboard: serializePlayers(room),
  });
  broadcastFamilyTurn(room);
}

/** Verplaatst de huidige speler en bepaalt/verstuurt wat er op de nieuwe tegel gebeurt. */
async function landOnTile(room: RoomState, playerId: string, roll: number) {
  const player = room.players.get(playerId);
  if (!player) return;

  const from = player.position ?? 0;
  const rawTo = from + roll;
  const finishIndex = room.finishIndex!;
  const board = room.board!;
  const reachedFinish = rawTo >= finishIndex;
  const to = Math.min(rawTo, finishIndex);
  player.position = to;

  if (reachedFinish) {
    ioInstance?.to(room.code).emit("family_landed", { playerId, from, to, tile: board[finishIndex], card: null, isFinish: true });
    await finishGame(room);
    return;
  }

  const tile = board[to];
  const difficulty: FamilyDifficulty = nextDifficulty("MEDIUM", player.streak ?? 0);
  let card: FamilyCard | null = null;

  if (tile.kind === "KNOWLEDGE" || tile.kind === "FILL_IN") {
    const exerciseCard = await pickExerciseCard(tile.kind, difficulty);
    card = exerciseCard;
    room.pendingTile = exerciseCard ? { kind: tile.kind, exerciseId: exerciseCard.exerciseId, playerId } : null;
  } else if (tile.kind === "WHERE_IN_BOOK") {
    const picked = await pickWhereInBookCard();
    card = picked?.card ?? null;
    room.pendingTile = picked ? { kind: "WHERE_IN_BOOK", correctChapterId: picked.correctChapterId, playerId } : null;
  } else if (tile.kind === "EVENT") {
    const eventCard = EVENT_CARDS[Math.floor(Math.random() * EVENT_CARDS.length)];
    card = { tileKind: "EVENT", slug: eventCard.slug, title: eventCard.title, choices: eventCard.choices.map((c) => c.label) };
    room.pendingTile = { kind: "EVENT", cardSlug: eventCard.slug, playerId };
  }

  ioInstance?.to(room.code).emit("family_landed", { playerId, from, to, tile, card, isFinish: false });

  // Geen content beschikbaar (zou alleen kunnen bij een compleet lege
  // database) — sla de tegel dan over i.p.v. de beurt te laten vastlopen.
  if (!room.pendingTile) advanceFamilyTurn(room);
}

function advanceFamilyTurn(room: RoomState) {
  room.currentTurnIndex = (room.currentTurnIndex! + 1) % room.turnOrder!.length;
  broadcastFamilyTurn(room);
}

async function handleFamilyAnswer(room: RoomState, socket: Socket, given: string[]) {
  const pending = room.pendingTile;
  if (!pending || pending.kind === "EVENT") return;
  if (!canActFor(room, socket, pending.playerId)) return;
  const player = room.players.get(pending.playerId);
  if (!player) return;

  let correct = false;
  let explanation: { verseRef: string; verseText: string | null } | { correctLabel: string } | null = null;

  if (pending.kind === "WHERE_IN_BOOK") {
    correct = given[0] === pending.correctChapterId;
    const labels = await labelsFor([pending.correctChapterId]);
    explanation = { correctLabel: labels.get(pending.correctChapterId)?.label ?? "?" };
  } else {
    const result = await checkExerciseAnswer(pending.exerciseId, given);
    correct = result?.correct ?? false;
    explanation = await explanationForExercise(pending.exerciseId);
  }

  player.streak = correct ? (player.streak ?? 0) + 1 : 0;
  if (correct) player.score += FAMILY_CORRECT_POINTS;
  room.pendingTile = null;

  ioInstance?.to(room.code).emit("family_reveal", {
    playerId: pending.playerId,
    correct,
    explanation,
    scoreboard: serializePlayers(room),
  });

  room.timer = setTimeout(() => advanceFamilyTurn(room), REVEAL_PAUSE_MS);
}

function handleFamilyEventChoice(room: RoomState, socket: Socket, choiceIndex: number) {
  const pending = room.pendingTile;
  if (!pending || pending.kind !== "EVENT") return;
  if (!canActFor(room, socket, pending.playerId)) return;
  const player = room.players.get(pending.playerId);
  if (!player) return;

  const eventCard = EVENT_CARDS.find((c) => c.slug === pending.cardSlug);
  const choice = eventCard?.choices[choiceIndex];
  if (!choice) return;

  player.score = Math.max(0, player.score + choice.delta);
  room.pendingTile = null;

  ioInstance?.to(room.code).emit("family_event_result", {
    playerId: pending.playerId,
    delta: choice.delta,
    label: choice.label,
    scoreboard: serializePlayers(room),
  });

  room.timer = setTimeout(() => advanceFamilyTurn(room), REVEAL_PAUSE_MS);
}

export function initGameServer(httpServer: HttpServer) {
  ioInstance = new SocketIOServer(httpServer, { path: "/socket.io" });
  setRealtimeServer(ioInstance);

  // Een net gestarte instantie heeft per definitie nog geen enkele
  // socket-verbinding, dus elke oude telling hier is die van vóór een
  // herstart (crash of deploy) die nooit een disconnect-event kreeg. Zonder
  // deze reset zou zo'n gebruiker voor altijd "online" blijven staan op
  // /adminbackend. Gaat (net als de rest van dit bestand, zie de
  // Redis-adapter hieronder) uit van precies één draaiende instantie.
  prisma.user.updateMany({ data: { onlineSocketCount: 0 } }).catch((err) => {
    console.error("Kon onlineSocketCount niet resetten bij opstarten:", err);
  });

  // Redis-adapter voor Socket.io: alle room-broadcasts (lobby/vraag/reveal)
  // lopen hierdoor via Redis pub/sub. Nu draait er één jehova-app-instantie,
  // maar dit is wat het mogelijk maakt om later zonder herbouw meerdere
  // instanties te draaien die dezelfde live-spellen kunnen bedienen.
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const pubClient = new Redis(redisUrl, { lazyConnect: false });
    const subClient = pubClient.duplicate();
    pubClient.on("error", (err) => console.error("Redis (pub) verbindingsfout:", err.message));
    subClient.on("error", (err) => console.error("Redis (sub) verbindingsfout:", err.message));
    ioInstance.adapter(createAdapter(pubClient, subClient));
  } else {
    console.warn(
      "REDIS_URL is niet gezet — Socket.io draait zonder Redis-adapter (werkt alleen correct met één jehova-app-instantie)."
    );
  }

  // Inloggen gebeurt in een middleware, niet in de connection-handler: de
  // client krijgt pas "connect" als deze klaar is. Met een await vóór de
  // socket.on(...)-registraties gingen berichten die een client direct bij
  // (her)verbinden stuurt (bv. opnieuw aanmelden bij een spel) verloren.
  ioInstance.use((socket, next) => {
    authenticateSocket(socket)
      .then((user) => {
        if (!user) return next(new Error("Niet ingelogd"));
        socket.data.user = user;
        next();
      })
      .catch(() => next(new Error("Niet ingelogd")));
  });

  ioInstance.on("connection", async (socket) => {
    const user = socket.data.user as NonNullable<Awaited<ReturnType<typeof authenticateSocket>>>;
    socket.data.userId = user.id;
    socket.data.displayName = user.handle;
    socket.join(`user:${user.id}`);
    registerAlleskennerHandlers(ioInstance!, socket, user);
    registerStudyHandlers(ioInstance!, socket, user);
    registerQuickMissionaryHandlers(ioInstance!, socket, user);

    // Aanwezigheid voor het adminoverzicht (/adminbackend): zie de opmerking
    // bij User.onlineSocketCount in schema.prisma voor waarom dit in de
    // database staat i.p.v. in-memory. Bewust niet afwachten, om dezelfde
    // reden als hierboven: de handlers hieronder moeten meteen klaarstaan. De
    // disconnect-handler wacht wel op deze ophoging, zodat een heel snelle
    // disconnect nooit vóór de ophoging telt.
    // lastSeenAt vóór de ophoging = het moment van de vorige disconnect, zodat
    // announceCameOnline een korte herverbinding kan herkennen.
    const counted = prisma.user
      .findUnique({ where: { id: user.id }, select: { lastSeenAt: true } })
      .then(async (before) => {
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: { onlineSocketCount: { increment: 1 }, lastSeenAt: new Date() },
          select: { onlineSocketCount: true },
        });
        await prisma.user.updateMany({
          where: { id: user.id, streakInterruptedDay: { not: null }, streakReturnSeenAt: null },
          data: { streakReturnSeenAt: new Date() },
        });
        return { previousSeenAt: before?.lastSeenAt ?? null, firstSocket: updated.onlineSocketCount === 1 };
      })
      .catch(() => null);
    const presenceCounted = counted.then(() => {});
    counted
      .then(async (result) => {
        await broadcastPresenceUpdate(ioInstance!, user.id);
        if (result?.firstSocket) await announceCameOnline(ioInstance, user.id, result.previousSeenAt);
      })
      .catch(() => {});

    // Vrienden-activiteit (zie src/lib/presence.ts): de client stuurt zelf al
    // een herkenbaar label mee (bv. "Leest Alma 32"), nooit een technisch ID
    // — deze handler valideert alleen lengte/vorm, verzint geen eigen tekst.
    socket.on("activity_update", (data: { icon?: string; label?: string } | null) => {
      if (!data || typeof data.icon !== "string" || typeof data.label !== "string") {
        clearCurrentActivity(user.id);
      } else {
        setCurrentActivity(user.id, data.icon.slice(0, 4), data.label);
      }
      broadcastPresenceUpdate(ioInstance, user.id).catch(() => {});
    });

    // De privacy-instellingen zelf (aan/uit-zetten, incognito) worden gezet
    // via /api/account — een gewone Next-routehandler, die via Next's eigen
    // bundeling een ANDERE modulinstantie van dit bestand gebruikt en dus
    // geen toegang heeft tot de echte, actieve ioInstance hierboven. De
    // client stuurt daarom na een geslaagde patch dit signaal over de
    // toch al open socketverbinding, zodat de instantie die er wél toe
    // doet de herberekende status (opnieuw uit de database gelezen, dus
    // altijd actueel) naar vrienden kan pushen.
    socket.on("presence_settings_changed", () => {
      broadcastPresenceUpdate(ioInstance, user.id).catch(() => {});
      sendFriendStatusesToUser(ioInstance, user.id).catch(() => {});
    });

    // De vriendenpagina haalt zijn lijst via /api/friends, maar die route
    // draait in Next's eigen bundel en ziet de activiteiten niet (die leven
    // in het geheugen van DEZE instantie, zie presence.ts). Na het laden
    // vraagt de pagina daarom hier de actuele statussen op, mét activiteit.
    socket.on("friend_statuses_request", () => {
      sendFriendStatusesToUser(ioInstance, user.id).catch(() => {});
    });

    // Live-data (src/lib/data): een client volgt een onderwerp alleen zolang de
    // gegevens in beeld zijn (bv. het klassement van het woord van de dag). Alleen
    // onderwerpen uit de vaste lijst; er gaat nooit data mee, alleen "ververs".
    socket.on("data_subscribe", (payload: { topic?: unknown } | null) => {
      if (isLiveTopic(payload?.topic)) socket.join(topicRoom(payload.topic));
    });
    socket.on("data_unsubscribe", (payload: { topic?: unknown } | null) => {
      if (isLiveTopic(payload?.topic)) socket.leave(topicRoom(payload.topic));
    });

    // Zelfde reden als hierboven: de accept-/verzoekroutes draaien in Next's
    // eigen bundel en kunnen deze Socket.io-instantie niet bereiken. Na een
    // geslaagd verzoek of een acceptatie seint de client dit zelf, zodat een
    // openstaande vriendenpagina van de ander direct ververst (in plaats van
    // "Wachten op ..." te blijven tonen). Alleen doorgeven als er echt een
    // vriendschap of verzoek tussen beiden bestaat; het signaal bevat geen
    // gegevens, de ander haalt alles zelf opnieuw op.
    socket.on("friendship_changed", async (payload: { otherUserId?: unknown }) => {
      const otherUserId = payload?.otherUserId;
      if (typeof otherUserId !== "string" || otherUserId === user.id) return;
      const related = await prisma.friendship
        .findFirst({
          where: {
            OR: [
              { senderId: user.id, receiverId: otherUserId },
              { senderId: otherUserId, receiverId: user.id },
            ],
          },
          select: { id: true },
        })
        .catch(() => null);
      if (related) {
        ioInstance?.to(`user:${otherUserId}`).emit("friends_changed");
        // De route die het verzoek opsloeg, kon het meldingencentrum van de
        // ander niet live bijwerken; dat gebeurt hier.
        ioInstance?.to(`user:${otherUserId}`).emit("notifications_changed");
      }
    });

    // Profielprivacy en uitgelichte prestaties zijn alleen zichtbaar voor
    // geaccepteerde vrienden. Na een eigen wijziging laat de eigenaar die
    // vrienden uitsluitend opnieuw ophalen; er gaan geen profielgegevens via
    // Socket.io en ingetrokken toestemming blijft dus niet in een cache staan.
    socket.on("friend_profile_changed", async () => {
      const friendIds = await getAcceptedFriendIds(user.id).catch(() => []);
      for (const friendId of friendIds) ioInstance?.to(`user:${friendId}`).emit("friends_changed");
    });

    // Woordspel: de routes draaien in Next's eigen bundel en kunnen deze
    // Socket.io-instantie niet bereiken (zelfde reden als hierboven). Na een
    // geslaagde actie seint de client dit, en de tegenstander krijgt het
    // meteen: een verse uitnodiging als melding bovenin (InviteListener), en
    // anders een seintje om lijst en bord te verversen. Alleen voor wie echt
    // in dit spel zit; wat er veranderde, leest de ander zelf uit de database.
    socket.on("scrabble_changed", async (payload: { gameId?: unknown }) => {
      const gameId = payload?.gameId;
      if (typeof gameId !== "string" || gameId.length > 64) return;
      const game = await prisma.scrabbleGame
        .findUnique({ where: { id: gameId }, select: { player1Id: true, player2Id: true, status: true, createdAt: true } })
        .catch(() => null);
      if (!game || (game.player1Id !== user.id && game.player2Id !== user.id)) return;
      const opponentId = game.player1Id === user.id ? game.player2Id : game.player1Id;
      ioInstance?.to(`user:${opponentId}`).emit("scrabble_updated", { gameId });
      ioInstance?.to(`user:${opponentId}`).emit("notifications_changed");
      // Een net verstuurde uitnodiging (alleen door de uitdager, alleen kort
      // na het aanmaken): niet bij elke latere herhaling van het seintje.
      if (game.status === "PENDING" && game.player1Id === user.id && Date.now() - game.createdAt.getTime() < 60_000) {
        ioInstance?.to(`user:${opponentId}`).emit("game_invite", {
          code: gameId,
          fromDisplayName: user.handle,
          fromUserId: user.id,
          gameLabel: "het Woordspel",
          href: "/scrabble",
        });
      }
    });

    socket.on("join_game", async ({ code }: { code: string }) => {
      const upperCode = code.toUpperCase();
      let room = rooms.get(upperCode);

      if (!room) {
        const game = await prisma.liveGame.findUnique({ where: { code: upperCode } });
        if (!game || game.status === "FINISHED") {
          socket.emit("error_message", { message: "Spel niet gevonden of al afgelopen." });
          return;
        }

        if (game.mode === "FAMILY_GAME") {
          room = {
            id: game.id,
            code: upperCode,
            hostId: game.hostId,
            status: game.status as RoomState["status"],
            mode: "FAMILY_GAME",
            timeLimitMs: 0,
            chapterId: null,
            exercises: [],
            level: null,
            cgQuestions: [],
            cgChapterLabels: new Map(),
            questionIndex: 0,
            questionStartedAt: 0,
            players: new Map(),
            board: BOARD,
            finishIndex: finishIndexFor(game.familyGameMinutes ?? 30),
            diceMode: game.familyGameDiceMode,
            turnOrder: [],
            currentTurnIndex: 0,
            pendingTile: null,
          };
        } else if (game.mode === "CHAPTER_GUESS") {
          const questions = await generateChapterGuessQuestions(game.level!, game.questionCount!);
          room = {
            id: game.id,
            code: upperCode,
            hostId: game.hostId,
            status: game.status as RoomState["status"],
            mode: "CHAPTER_GUESS",
            timeLimitMs: CHAPTER_GUESS_TIME_MS,
            chapterId: null,
            exercises: [],
            level: game.level,
            cgQuestions: questions,
            cgChapterLabels: await labelsFor(collectChapterIds(questions)),
            questionIndex: 0,
            questionStartedAt: 0,
            players: new Map(),
          };
        } else {
          room = {
            id: game.id,
            code: upperCode,
            hostId: game.hostId,
            status: game.status as RoomState["status"],
            mode: "EXERCISES",
            timeLimitMs: EXERCISES_TIME_MS,
            chapterId: game.chapterId,
            exercises: await loadExercises(game.chapterId!),
            level: null,
            cgQuestions: [],
            cgChapterLabels: new Map(),
            questionIndex: 0,
            questionStartedAt: 0,
            players: new Map(),
          };
        }
        rooms.set(upperCode, room);
      }

      let player = room.players.get(user.id);

      // Een spel dat al bezig is, accepteert geen nieuwe spelers meer — maar
      // wie er al aan meedeed (bv. na wegnavigeren en teruggekomen, of een
      // paginaverversing) mag wél terug: zie resyncSocket hierboven.
      if (room.status !== "LOBBY" && !player) {
        socket.emit("error_message", { message: "Dit spel is al begonnen." });
        return;
      }

      socket.join(upperCode);
      socket.data.gameCode = upperCode;

      if (!player) {
        player = {
          userId: user.id,
          displayName: user.handle,
          socketIds: new Set(),
          score: 0,
          correctCount: 0,
          hintUsedThisQuestion: false,
          ...(room.mode === "FAMILY_GAME" ? { isGuest: false, position: 0, streak: 0 } : {}),
        };
        room.players.set(user.id, player);
        if (room.mode === "FAMILY_GAME") room.turnOrder!.push(user.id);
        await prisma.liveGamePlayer
          .upsert({
            where: { gameId_userId: { gameId: room.id, userId: user.id } },
            create: { gameId: room.id, userId: user.id },
            update: {},
          })
          .catch(() => {});
      }
      player.socketIds.add(socket.id);

      if (room.status === "LOBBY") {
        broadcastLobby(room);
      } else {
        resyncSocket(socket, room);
      }
    });

    // Alleen de host kan een gast toevoegen — gasten bestaan alleen op het
    // apparaat van de host (zie de uitleg bij RoomPlayer.isGuest hierboven).
    socket.on("add_guest", ({ name }: { name: string }) => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.mode !== "FAMILY_GAME" || room.hostId !== user.id || room.status !== "LOBBY") return;
      const trimmed = name.trim().slice(0, 24);
      if (!trimmed) return;

      const guestId = `guest:${randomUUID()}`;
      room.players.set(guestId, {
        userId: guestId,
        displayName: trimmed,
        socketIds: new Set(),
        score: 0,
        correctCount: 0,
        hintUsedThisQuestion: false,
        isGuest: true,
        position: 0,
        streak: 0,
      });
      room.turnOrder!.push(guestId);
      broadcastLobby(room);
    });

    socket.on("remove_guest", ({ guestId }: { guestId: string }) => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.mode !== "FAMILY_GAME" || room.hostId !== user.id || room.status !== "LOBBY") return;
      const player = room.players.get(guestId);
      if (!player?.isGuest) return;
      room.players.delete(guestId);
      room.turnOrder = room.turnOrder!.filter((id) => id !== guestId);
      broadcastLobby(room);
    });

    socket.on("start_game", async () => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.hostId !== user.id || room.status !== "LOBBY") return;

      if (room.mode === "FAMILY_GAME") {
        if (room.turnOrder!.length < 2) {
          socket.emit("error_message", { message: "Voeg minstens nog één speler of gast toe." });
          return;
        }
        await startFamilyGame(room);
        return;
      }

      if (totalQuestions(room) === 0) {
        socket.emit("error_message", {
          message: room.mode === "EXERCISES" ? "Dit hoofdstuk heeft geen oefeningen." : "Kon geen vragen genereren.",
        });
        return;
      }

      room.status = "IN_PROGRESS";
      await prisma.liveGame.update({ where: { code }, data: { status: "IN_PROGRESS" } });
      revokeOpenInvites(code).catch(() => {});
      broadcastLobby(room);
      askQuestion(room);
    });

    // Dobbelsteen (DIGITAL): de server gooit, nooit de client — anders zou
    // een op afstand meespelend account zijn eigen worp kunnen manipuleren
    // (zie de sessieafspraak over server-autoriteit). Alleen de speler die
    // aan de beurt is (of de host namens een gast, zie canActFor) mag gooien.
    socket.on("roll_dice", async () => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.mode !== "FAMILY_GAME" || room.status !== "IN_PROGRESS" || room.pendingTile) return;
      const currentId = currentFamilyPlayerId(room);
      if (!currentId || !canActFor(room, socket, currentId)) return;
      if (room.diceMode !== "DIGITAL") return;

      const roll = 1 + Math.floor(Math.random() * 6);
      ioInstance?.to(room.code).emit("family_dice_result", { playerId: currentId, roll });
      await landOnTile(room, currentId, roll);
    });

    // Dobbelsteen (PHYSICAL): een echte dobbelsteen — de speler voert het
    // aantal ogen zelf in. Net zo'n volwaardige, vertrouwde invoer als elk
    // ander door een mens ingevoerd spelresultaat elders in de app (zie de
    // sessieafspraak: dit is geen tijdelijke workaround maar een officiële
    // spelmodus).
    socket.on("enter_physical_roll", async ({ value }: { value: number }) => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.mode !== "FAMILY_GAME" || room.status !== "IN_PROGRESS" || room.pendingTile) return;
      const currentId = currentFamilyPlayerId(room);
      if (!currentId || !canActFor(room, socket, currentId)) return;
      if (room.diceMode !== "PHYSICAL") return;
      if (!Number.isInteger(value) || value < 1 || value > 6) return;

      await landOnTile(room, currentId, value);
    });

    socket.on("submit_family_answer", ({ given }: { given: string[] }) => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.mode !== "FAMILY_GAME" || room.status !== "IN_PROGRESS") return;
      handleFamilyAnswer(room, socket, given).catch(() => {});
    });

    socket.on("choose_event", ({ choiceIndex }: { choiceIndex: number }) => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.mode !== "FAMILY_GAME" || room.status !== "IN_PROGRESS") return;
      handleFamilyEventChoice(room, socket, choiceIndex);
    });

    socket.on("submit_answer", ({ given }: { given: string[] }) => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.status !== "IN_PROGRESS") return;
      registerAnswer(room, user.id, given);
    });

    socket.on("use_hint", async () => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.status !== "IN_PROGRESS" || room.mode !== "CHAPTER_GUESS") return;
      if (room.level === "EXPERT") {
        socket.emit("hint_error", { message: "Hints zijn niet beschikbaar op expert-niveau." });
        return;
      }
      const player = room.players.get(user.id);
      if (!player || player.hintUsedThisQuestion) return;

      // Eén gedeeld tegoed (User.hintBalance, zie src/lib/shop.ts) — de
      // `gt: 0`-voorwaarde maakt dit race-veilig bij een dubbelklik.
      const result = await prisma.user.updateMany({
        where: { id: user.id, hintBalance: { gt: 0 } },
        data: { hintBalance: { decrement: 1 } },
      });
      if (result.count === 0) {
        // Los "hint_error"-event i.p.v. het generieke "error_message": dat
        // laatste zet de client naar een volle foutpagina (spel niet
        // gevonden/al gestart e.d.), wat hier te drastisch zou zijn voor
        // "geen hint over" — de vraag loopt gewoon door.
        socket.emit("hint_error", { message: "Je hebt geen hint beschikbaar — geef eerst een goed antwoord, of koop er een in de winkel." });
        return;
      }
      player.hintUsedThisQuestion = true;

      const question = room.cgQuestions[room.questionIndex];
      const effect = computeHintEffect(room.level!, question.chapterId, question.optionIds, room.cgChapterLabels.get(question.chapterId) ?? null);
      const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { hintBalance: true } });
      socket.emit("hint_result", { ...effect, hintBalance: dbUser?.hintBalance ?? 0 });
    });

    socket.on("forfeit", () => {
      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.status !== "IN_PROGRESS") return;
      room.forfeitedBy = user.id;
      finishGame(room);
    });

    socket.on("invite_friend", async ({ toUserId, code }: { toUserId: string; code: string }) => {
      const game = await prisma.liveGame.findUnique({
        where: { code: code.toUpperCase() },
        include: { host: true, chapter: { include: { book: true } } },
      });
      if (!game || game.status !== "LOBBY") return;
      const friendship = await prisma.friendship.findFirst({
        where: {
          status: "ACCEPTED",
          OR: [
            { senderId: user.id, receiverId: toUserId },
            { senderId: toUserId, receiverId: user.id },
          ],
        },
      });
      if (!friendship) return;
      // Persistent bijgehouden (naast de live pushnotificatie hieronder) zodat
      // /api/activity-status een nog niet geaccepteerde uitnodiging kan tonen
      // als "wachten op reactie" — anders zou zo'n lobby na het versturen van
      // de uitnodiging nergens meer terug te vinden zijn voor de host.
      await prisma.liveGameInvite
        .upsert({
          where: { gameId_userId: { gameId: game.id, userId: toUserId } },
          create: { gameId: game.id, userId: toUserId },
          update: {},
        })
        .catch(() => {});
      // In de taal van de ontvanger: de melding bovenin toont dit letterlijk.
      const recipient = await prisma.user.findUnique({ where: { id: toUserId }, select: { uiLanguage: true } });
      const gameLabel = liveGameLabel(game, getT(recipient?.uiLanguage));
      ioInstance?.to(`user:${toUserId}`).emit("game_invite", {
        code: game.code,
        fromDisplayName: user.handle,
        fromUserId: user.id,
        gameLabel,
      });

      // Altijd in het meldingencentrum; notifyUser stuurt alleen een push als
      // de app bij de ander nergens open staat (anders zag hij net de melding
      // bovenin al).
      notifyGameInvite(toUserId, user.handle, (t) => liveGameLabel(game, t), game.code).catch(() => {});
    });

    // Alleen de host kan een spel dat nog niet gestart is beëindigen — nodig
    // omdat een lobby anders eindeloos blijft "openstaan" (zie
    // /api/activity-status) als een uitgenodigde vriend nooit reageert.
    // Werkt vanaf elke pagina (niet alleen vanuit de lobby zelf): de code
    // wordt expliciet meegestuurd, net als bij join_game hierboven, i.p.v.
    // te vertrouwen op socket.data.gameCode.
    socket.on("cancel_game", async ({ code }: { code: string }) => {
      const upperCode = code.toUpperCase();
      const game = await prisma.liveGame.findUnique({ where: { code: upperCode } });
      if (!game || game.hostId !== user.id || game.status !== "LOBBY") {
        socket.emit("error_message", { message: "Kon dit spel niet beëindigen." });
        return;
      }
      // Wie in de lobby zat, vóór het verwijderen ophalen (de spelersrijen
      // gaan mee met het spel). Via ieders eigen user-room en niet via de
      // spelcode: De Slimste Heilige zet spelers niet in die socket-room, en zo
      // krijgen ook andere open tabbladen (bv. de actieve-spellenbanner) het
      // mee.
      const playerIds = (
        await prisma.liveGamePlayer.findMany({ where: { gameId: game.id }, select: { userId: true } }).catch(() => [])
      ).map((p) => p.userId);
      await revokeOpenInvites(upperCode).catch(() => {});
      await prisma.liveGame.delete({ where: { id: game.id } }).catch(() => {});
      rooms.delete(upperCode);
      forgetAlleskennerRoom(upperCode);
      forgetStudyRoom(upperCode);
      forgetQuickMissionaryRoom(upperCode);
      for (const playerId of new Set([...playerIds, user.id])) {
        ioInstance?.to(`user:${playerId}`).emit("game_cancelled", { code: upperCode });
      }
      ioInstance?.in(upperCode).socketsLeave(upperCode);
    });

    // Een speler (niet de host) verlaat zelf de lobby. Alleen vóór de start:
    // tijdens een spel is er "opgeven" (forfeit). De uitnodiging blijft
    // geldig, dus wie per ongeluk vertrekt, kan gewoon terugkomen.
    socket.on("leave_game", async ({ code }: { code?: unknown }) => {
      if (typeof code !== "string") return;
      const upperCode = code.toUpperCase();
      const room = rooms.get(upperCode);
      let gameId = room?.id ?? null;
      if (room) {
        if (room.status !== "LOBBY" || room.hostId === user.id) return;
        const player = room.players.get(user.id);
        if (player) {
          room.players.delete(user.id);
          if (room.turnOrder) room.turnOrder = room.turnOrder.filter((id) => id !== user.id);
          for (const socketId of player.socketIds) {
            const playerSocket = ioInstance?.sockets.sockets.get(socketId);
            if (!playerSocket) continue;
            playerSocket.leave(upperCode);
            if (playerSocket.data.gameCode === upperCode) playerSocket.data.gameCode = undefined;
          }
        }
        broadcastLobby(room);
      } else {
        // Na een herstart van de server staat de lobby alleen nog in de database.
        const game = await prisma.liveGame.findUnique({ where: { code: upperCode } });
        if (!game || game.status !== "LOBBY" || game.hostId === user.id) return;
        gameId = game.id;
      }
      if (gameId) await prisma.liveGamePlayer.deleteMany({ where: { gameId, userId: user.id } }).catch(() => {});
      ioInstance?.to(`user:${user.id}`).emit("game_left", { code: upperCode });
    });

    socket.on("disconnect", () => {
      presenceCounted
        .then(() =>
          prisma.user.update({
            where: { id: user.id },
            // Nooit onder 0: bij een servercrash met nog "open" tellingen (zie
            // de reset bij het opstarten in initGameServer hieronder) zou een
            // losse late disconnect anders negatief kunnen tellen.
            data: { onlineSocketCount: { decrement: 1 }, lastSeenAt: new Date() },
          })
        )
        .then(async (updated) => {
          let socketCount = updated.onlineSocketCount;
          if (socketCount < 0) {
            await prisma.user.update({ where: { id: user.id }, data: { onlineSocketCount: 0 } });
            socketCount = 0;
          }
          // Alleen de activiteit wissen als dit echt de laatste open
          // tab/apparaat was — anders verdwijnt "Leest Alma 32" ten onrechte
          // zodra je één van meerdere tabbladen sluit.
          if (socketCount === 0) clearCurrentActivity(user.id);
          await broadcastPresenceUpdate(ioInstance, user.id);
        })
        .catch(() => {});

      const code = socket.data.gameCode as string | undefined;
      if (!code) return;
      const room = rooms.get(code);
      const player = room?.players.get(user.id);
      player?.socketIds.delete(socket.id);
      if (room && player && player.socketIds.size === 0 && room.status === "LOBBY") {
        room.players.delete(user.id);
        if (room.mode === "FAMILY_GAME") room.turnOrder = room.turnOrder!.filter((id) => id !== user.id);
        broadcastLobby(room);
      }
    });
  });
}
