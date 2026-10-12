import { canResumeGameContent, canResumeLiveGame } from "@/lib/gameAvailability";
import { getT } from "@/lib/i18n";
import type { Server as SocketIOServer, Socket } from "socket.io";
import { prisma } from "@/lib/db";
import { notifyGameInvite, removeNotificationsByUrl } from "@/lib/notify";
import { cancelSeasonEvening, recordSeasonEvening } from "@/lib/alleskenner/season";
import { recordSoloRun, type SoloItems, type SoloResult } from "@/lib/alleskenner/solo";
import {
  answerMatches,
  bookOfRef,
  type GalleryData,
  type MemoryData,
  type PuzzleData,
  type QuestionData,
  type TopicAnswer,
} from "@/lib/alleskenner/content";
import {
  alleskennerLanguageFor,
  alleskennerLanguages,
  bookNamePairs,
  editionCollectionId,
  ensureAlleskennerContent,
  itemTranslations,
  itemsByIds,
  kidsStory,
  markSeen,
  passageVerses,
  pickItems,
  siblingBookNames,
  verseTextByRef,
  type PickedItem,
} from "@/lib/alleskenner/pool";
import {
  addItemPairs,
  addPair,
  canonicalText,
  emptyDictionary,
  localizeFeedback,
  localizeText,
  type AkDictionary,
} from "@/lib/alleskenner/localize";
import type { AlleskennerItemKind } from "@/generated/prisma/client";
import { DEFAULT_LANGUAGE } from "@/lib/languages";
import {
  AK_369_POINTS,
  AK_369_THINK_MS,
  AK_LISTEN_MAX_MS,
  AK_FINALE_PENALTY,
  AK_GALLERY_POINTS,
  AK_MAX_TEAMS,
  AK_MEMORY_READ_MS,
  AK_MEMORY_STEP,
  AK_MIN_PLAYERS,
  AK_MIN_TEAM_PLAYERS,
  AK_OPEN_DEUR_POINTS,
  AK_PUZZLE_POINTS,
  AK_PUZZLE_TURN_MS,
  AK_ROUND_TITLES,
  AK_ROUNDS,
  AK_START_SECONDS,
  AK_TEAM_NAMES,
  type AkGridCell,
  type AkLength,
  type AkPhase,
  type AkRole,
  type AkStateView,
} from "@/lib/alleskenner/types";

// Spelserver voor De Slimste Heilige (zie docs/ALLESKENNER.md). Wordt geladen via
// gameServer.ts en valt dus onder de eager-importketen van server.ts: hier
// nooit request-scoped Next-API's importeren (zie CLAUDE.md). De spelstatus
// leeft in het geheugen van deze ene instantie, net als bij de andere
// live-spellen; de server is de enige bron van waarheid voor beurten, klokken
// en seconden.
//
// Alles wat punten krijgt of aan de beurt is, is een "deelnemer": een losse
// speler of een team. Bij een team handelt alleen de teamleider; de andere
// leden kiezen stil mee voor hun persoonlijke punten, die pas bij de
// onthulling worden beoordeeld (anders zouden ze het antwoord kunnen
// doorfluisteren).

const TICK_MS = 200;
const BROADCAST_EVERY_MS = 1000;
const REVEAL_369_MS = 2500;
const BETWEEN_TURNS_MS = 1200;
const REVEAL_ROUND_ITEM_MS = 4000;
const INTERMISSION_MS = 3500;
const STANDINGS_MS = 3000;
const CHOOSE_DOOR_MS = 30_000;
const ROOM_TTL_AFTER_FINISH_MS = 30 * 60 * 1000;
const QUESTIONS_369 = 15;
const FINALE_TOPICS = 6;
const FINALE_ANSWERS = 5;
const OPEN_DEUR_ANSWERS = 4;
const MEMORY_ANSWERS = 5;
const GRID_SIZE = 12;
const OPEN_DEUR_GRID_SIZE = 10;
const PUZZLE_SILENT_GUESSES = 3;

interface Participant {
  userId: string;
  name: string;
  role: AkRole;
  team: number | null; // lobby: teamindex bij teamspel
}

interface Contestant {
  id: string;
  name: string;
  members: string[];
  leaderId: string;
  color: number;
}

interface GridItem {
  id: string;
  subject: string;
  answers: TopicAnswer[];
  grid: string[];
  passage?: string;
  verses?: { number: number; text: string }[];
  // Uitspraken om aan te tikken (automatisch samengestelde onderwerpen): ook
  // met quizmaster tikt wie aan de beurt is zelf, want hardop noemen past niet.
  tapOnly?: boolean;
}

// Gedeeld door Open Deur, Collectief Geheugen en de Finale: een onderwerp met
// een aantal goede antwoorden, tikvakjes, en een wachtrij van deelnemers die
// na elkaar mogen aanvullen.
interface GridRound {
  items: GridItem[];
  index: number;
  found: boolean[];
  foundOrder: { index: number; value: number }[];
  wrong: Set<string>;
  queue: string[];
  revealed: boolean;
  picks: Map<string, Set<string>>;
}

interface GalleryEntry {
  text: string | null;
  image: string | null;
  answer: string;
  options: string[];
}

// Seizoensavond: vaste opstelling van drie, nieuwkomers eerst; alle leden
// tellen mee voor "niets herhalen binnen een seizoen".
interface SeasonInfo {
  eveningId: string;
  seasonId: string;
  isFinale: boolean;
  isLast: boolean;
  lineup: string[];
  names: Record<string, string>;
  memberIds: string[];
  managerIds: string[]; // host en vervangende host van het seizoen (mogen altijd binnen)
  safeId: string | null; // De Slimste Heilige van de avond (hoogste stand na de rondes)
  afterRounds: { userId: string; seconds: number }[];
}

interface Room {
  code: string;
  gameId: string;
  season: SeasonInfo | null;
  // Alleen spelen: één deelnemer, geen LiveGame; het resultaat gaat naar
  // AlleskennerSoloRun (zie src/lib/alleskenner/solo.ts).
  solo: { runId: string; mode: "DAILY" | "PRACTICE"; result: SoloResult | null } | null;
  hostId: string;
  quizmasterId: string | null;
  participants: Map<string, Participant>;
  sockets: Map<string, Set<string>>;
  length: AkLength;
  teamMode: boolean;
  lobbyTeams: { leaderId: string | null }[];
  phase: AkPhase;
  rounds: AkPhase[];
  roundIndex: number;
  contestants: Contestant[];
  seconds: Map<string, number>;
  personal: Map<string, number>;
  activeId: string | null;
  clockRunning: boolean;
  turnDeadline: number | null;
  intermission: { title: string; subtitle: string; standings: boolean } | null;
  pending: { at: number; run: () => void } | null;
  r369: {
    items: { id: string; data: QuestionData; listenText: string | null }[];
    index: number;
    reveal: { correct: boolean | null } | null;
    picks: Map<string, string>;
    starter: string | null; // kreeg de vraag als eerste; krijgt de volgende als niemand het weet
    attempted: string[]; // deelnemers die deze vraag al fout hadden
    wrongOptions: string[];
    listening: boolean; // luistervraag: bedenktijd start pas na het voorlezen
  } | null;
  openDeur: (GridRound & { owners: string[]; taken: boolean[]; choosing: boolean }) | null;
  puzzle: {
    items: { id: string; data: PuzzleData; clues: { text: string; group: number }[] }[];
    index: number;
    found: boolean[];
    queue: string[];
    owners: string[];
    revealed: boolean;
    picks: Map<string, Set<number>>;
    guesses: Map<string, string[]>;
  } | null;
  gallery: {
    items: { id: string; variant: "QUOTES" | "IMAGES"; entries: GalleryEntry[] }[];
    index: number;
    owners: string[];
    found: boolean[];
    queue: string[];
    turnEntries: number[];
    turnPos: number;
    revealed: boolean;
    picks: Map<string, Map<number, string>>;
  } | null;
  memory: (GridRound & { owners: string[]; reading: boolean }) | null;
  finale: (GridRound & { finalists: [string, string] }) | null;
  winnerId: string | null;
  feedback: AkStateView["feedback"];
  // Taal waarin elke deelnemer speelt, en per taal (behalve Nederlands) het
  // woordenboek van dit spel (zie src/lib/alleskenner/localize.ts).
  languages: Map<string, string>;
  dictionaries: Map<string, AkDictionary>;
  starting: boolean;
  lastTick: number;
  lastBroadcast: number;
  timer: NodeJS.Timeout | null;
}

const rooms = new Map<string, Room>();
let io: SocketIOServer | null = null;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dictionaryFor(room: Room, userId: string): AkDictionary | null {
  return room.dictionaries.get(room.languages.get(userId) ?? DEFAULT_LANGUAGE) ?? null;
}

/** Legt de speltaal van deze deelnemers vast (hun contenttaal, anders de terugvaltaal). */
async function assignLanguages(room: Room, userIds: string[]) {
  const available = await alleskennerLanguages();
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, contentLanguage: true } });
  for (const user of users) room.languages.set(user.id, alleskennerLanguageFor(user.contentLanguage, available));
}

/** Talen van de deelnemers, behalve Nederlands: elk gekozen onderdeel moet daarin bestaan. */
function roomLanguages(room: Room): string[] {
  return [...new Set([...room.languages.values()].filter((l) => l !== DEFAULT_LANGUAGE))];
}

function nameOf(room: Room, userId: string): string {
  return room.participants.get(userId)?.name ?? "Speler";
}

function lobbyPlayers(room: Room): Participant[] {
  return [...room.participants.values()].filter((p) => p.role === "player");
}

function contestantById(room: Room, id: string | null): Contestant | null {
  return id ? (room.contestants.find((c) => c.id === id) ?? null) : null;
}

function contestantOf(room: Room, userId: string): Contestant | null {
  return room.contestants.find((c) => c.members.includes(userId)) ?? null;
}

function contestantIds(room: Room): string[] {
  return room.contestants.map((c) => c.id);
}

function contestantName(room: Room, id: string): string {
  return contestantById(room, id)?.name ?? "Speler";
}

function secondsOf(room: Room, id: string): number {
  return room.seconds.get(id) ?? 0;
}

function addSeconds(room: Room, id: string, delta: number) {
  room.seconds.set(id, Math.max(0, secondsOf(room, id) + delta));
}

function addPersonal(room: Room, userId: string, points: number) {
  if (!room.teamMode || points === 0) return;
  room.personal.set(userId, (room.personal.get(userId) ?? 0) + points);
}

function orderIndex(room: Room, id: string): number {
  return room.contestants.findIndex((c) => c.id === id);
}

/** Deelnemers oplopend op seconden; bij gelijke stand de startvolgorde. */
function byFewestSeconds(room: Room, ids: string[]): string[] {
  return [...ids].sort((a, b) => secondsOf(room, a) - secondsOf(room, b) || orderIndex(room, a) - orderIndex(room, b));
}

function byMostSeconds(room: Room, ids: string[]): string[] {
  return [...ids].sort((a, b) => secondsOf(room, b) - secondsOf(room, a) || orderIndex(room, a) - orderIndex(room, b));
}

function feedback(room: Room, contestantId: string | null, text: string, kind: "good" | "bad" | "info") {
  room.feedback = { contestantId, text, kind, at: Date.now() };
}

function schedule(room: Room, delayMs: number, run: () => void) {
  room.pending = { at: Date.now() + delayMs, run };
}

function standingsText(room: Room): string {
  return byMostSeconds(room, contestantIds(room))
    .map((id) => `${contestantName(room, id)} ${Math.round(secondsOf(room, id))}`)
    .join(" · ");
}

// --- Wie mag wat ------------------------------------------------------------

/**
 * "team": deze tik telt als antwoord van de deelnemer die aan de beurt is.
 * "silent": stil meekiezen voor persoonlijke punten (alleen bij teams).
 * null: negeren. Met quizmaster antwoordt de teamleider hardop, dus dan telt
 * zijn tik niet — de quizmaster beoordeelt.
 */
function actorKind(room: Room, userId: string): "team" | "silent" | null {
  if (room.participants.get(userId)?.role !== "player") return null;
  const active = contestantById(room, room.activeId);
  if (active && active.leaderId === userId) return room.quizmasterId ? null : "team";
  return room.teamMode ? "silent" : null;
}

function leaderOfActive(room: Room): string | null {
  return contestantById(room, room.activeId)?.leaderId ?? null;
}

// --- Weergave per deelnemer -------------------------------------------------

function gridCells(room: Room, round: GridRound, viewerId: string, answerCount: number, L: (text: string) => string): AkGridCell[] | null {
  const item = round.items[round.index];
  const showGrid = room.quizmasterId === null || room.teamMode || item.tapOnly;
  if (!showGrid) return null;
  const answers = item.answers.slice(0, answerCount);
  const mine = round.picks.get(viewerId);
  return item.grid.map((text) => {
    const answerIndex = answers.findIndex((a) => a.text === text);
    const state: AkGridCell["state"] =
      answerIndex >= 0 && round.found[answerIndex] ? "found" : round.wrong.has(text) ? "wrong" : "open";
    return { text: L(text), state, mine: mine?.has(text) ?? false };
  });
}

function currentGridItem(round: GridRound | null): GridItem | null {
  if (!round || round.index < 0 || round.index >= round.items.length) return null;
  return round.items[round.index];
}

function foundTexts(round: GridRound, L: (text: string) => string): string[] {
  const item = round.items[round.index];
  return round.foundOrder.map((f) => L(item.answers[f.index].text));
}

function buildView(room: Room, viewerId: string): AkStateView {
  const viewer = room.participants.get(viewerId);
  const isQuizmaster = room.quizmasterId === viewerId;
  const showOptions = room.quizmasterId === null || room.teamMode;
  const myContestant = contestantOf(room, viewerId);
  // Teksten van onderdelen in de taal van deze kijker; intern blijft alles Nederlands.
  const dictionary = dictionaryFor(room, viewerId);
  const L = (text: string) => localizeText(dictionary, text);
  const Lmaybe = (text: string | null) => (text === null ? null : L(text));

  let r369: AkStateView["r369"] = null;
  if (room.phase === "R369" && room.r369 && room.r369.index < room.r369.items.length) {
    const current = room.r369.items[room.r369.index];
    const number = room.r369.index + 1;
    r369 = {
      number,
      total: room.r369.items.length,
      isPointQuestion: number % 3 === 0,
      prompt: L(current.data.prompt),
      listenText: Lmaybe(current.listenText),
      options: showOptions ? current.data.options.map(L) : null,
      myPick: Lmaybe(room.r369.picks.get(viewerId) ?? null),
      wrongOptions: room.r369.wrongOptions.map(L),
      listening: room.r369.listening,
      reveal: room.r369.reveal ? { correct: room.r369.reveal.correct, answer: L(current.data.answer) } : null,
    };
  }

  let openDeur: AkStateView["openDeur"] = null;
  if (room.phase === "OPEN_DEUR" && room.openDeur && room.openDeur.owners.length > 0) {
    const state = room.openDeur;
    const item = state.choosing ? null : currentGridItem(state);
    openDeur = {
      number: state.owners.length,
      total: Math.min(state.items.length, room.contestants.length),
      choosing: state.choosing,
      doors: state.items.map((it, index) => ({ index, subject: L(it.subject), taken: state.taken[index] })),
      subject: item ? L(item.subject) : null,
      found: item ? foundTexts(state, L) : [],
      answerCount: OPEN_DEUR_ANSWERS,
      grid: item && !state.revealed ? gridCells(room, state, viewerId, OPEN_DEUR_ANSWERS, L) : null,
      tapOnly: item?.tapOnly ?? false,
      revealed: item && state.revealed ? item.answers.slice(0, OPEN_DEUR_ANSWERS).map((a) => L(a.text)) : null,
    };
  }

  let puzzle: AkStateView["puzzle"] = null;
  if (room.phase === "PUZZLE" && room.puzzle && room.puzzle.index >= 0 && room.puzzle.index < room.puzzle.items.length) {
    const current = room.puzzle.items[room.puzzle.index];
    const { found, revealed } = room.puzzle;
    puzzle = {
      number: room.puzzle.index + 1,
      total: room.puzzle.items.length,
      clues: current.clues.map((c) => ({ text: L(c.text), group: found[c.group] || revealed ? c.group : null })),
      found: current.data.groups
        .map((g, group) => ({ group, answer: L(g.answer) }))
        .filter(({ group }) => found[group] || revealed),
      revealed,
      myGuesses: room.teamMode ? (room.puzzle.guesses.get(viewerId) ?? []) : null,
    };
  }

  let gallery: AkStateView["gallery"] = null;
  if (room.phase === "GALLERY" && room.gallery && room.gallery.index >= 0 && room.gallery.index < room.gallery.items.length) {
    const state = room.gallery;
    const current = state.items[state.index];
    const entryIndex = state.turnEntries[state.turnPos] ?? -1;
    const entry = room.activeId && entryIndex >= 0 ? current.entries[entryIndex] : null;
    gallery = {
      number: state.index + 1,
      total: state.items.length,
      variant: current.variant,
      itemIndex: entryIndex,
      itemCount: current.entries.length,
      item: entry ? { text: Lmaybe(entry.text), image: entry.image } : null,
      options: entry && showOptions ? entry.options.map(L) : null,
      myPick: entryIndex >= 0 ? Lmaybe(state.picks.get(viewerId)?.get(entryIndex) ?? null) : null,
      results: current.entries.map((e, i) => ({
        found: state.found[i],
        answer: state.found[i] || state.revealed ? L(e.answer) : null,
      })),
      revealed: state.revealed
        ? current.entries.map((e, i) => ({ text: Lmaybe(e.text), image: e.image, answer: L(e.answer), found: state.found[i] }))
        : null,
    };
  }

  let memory: AkStateView["memory"] = null;
  if (room.phase === "MEMORY" && room.memory) {
    const state = room.memory;
    const item = currentGridItem(state);
    if (item) {
      memory = {
        number: state.owners.length,
        total: Math.min(state.items.length, room.contestants.length),
        title: L(item.subject),
        passage: L(item.passage ?? ""),
        reading: state.reading,
        verses: state.reading ? (item.verses ?? []).map((v) => ({ number: v.number, text: L(v.text) })) : null,
        nextValue: (state.foundOrder.length + 1) * AK_MEMORY_STEP,
        found: state.foundOrder.map((f) => ({ text: L(item.answers[f.index].text), value: f.value })),
        answerCount: MEMORY_ANSWERS,
        grid: !state.reading && !state.revealed ? gridCells(room, state, viewerId, MEMORY_ANSWERS, L) : null,
        revealed: state.revealed ? item.answers.slice(0, MEMORY_ANSWERS).map((a) => L(a.text)) : null,
      };
    }
  }

  let finale: AkStateView["finale"] = null;
  if (room.phase === "FINALE" && room.finale) {
    const state = room.finale;
    const item = currentGridItem(state);
    if (item) {
      finale = {
        number: state.index + 1,
        total: state.items.length,
        subject: L(item.subject),
        found: foundTexts(state, L),
        answerCount: Math.min(FINALE_ANSWERS, item.answers.length),
        grid: !state.revealed ? gridCells(room, state, viewerId, FINALE_ANSWERS, L) : null,
        tapOnly: item.tapOnly ?? false,
        revealed: state.revealed ? item.answers.slice(0, FINALE_ANSWERS).map((a) => L(a.text)) : null,
      };
    }
  }

  let quizmaster: AkStateView["quizmaster"] = null;
  if (isQuizmaster) {
    const q = room.phase === "R369" && room.r369 ? room.r369.items[room.r369.index] : null;
    const p = room.phase === "PUZZLE" && room.puzzle ? room.puzzle.items[room.puzzle.index] : null;
    const gridRound =
      room.phase === "OPEN_DEUR" && room.openDeur && !room.openDeur.choosing
        ? { round: room.openDeur as GridRound, count: OPEN_DEUR_ANSWERS }
        : room.phase === "MEMORY" && room.memory
          ? { round: room.memory as GridRound, count: MEMORY_ANSWERS }
          : room.phase === "FINALE" && room.finale
            ? { round: room.finale as GridRound, count: FINALE_ANSWERS }
            : null;
    const gridItem = gridRound ? currentGridItem(gridRound.round) : null;
    const g = room.phase === "GALLERY" && room.gallery ? room.gallery : null;
    const galleryEntry = g && g.index >= 0 && g.index < g.items.length ? g.items[g.index].entries[g.turnEntries[g.turnPos]] : null;
    // De quizmaster moet het antwoord kunnen voorlezen/beoordelen in de taal
    // waarin de actieve speler speelt. Bij teams is dat de taal van de
    // teamleider, omdat die het antwoord hardop geeft; buiten een beurt valt
    // de weergave terug op de taal van de quizmaster.
    const activeLanguageUserId = leaderOfActive(room) ?? viewerId;
    const answerDictionary = dictionaryFor(room, activeLanguageUserId) ?? dictionary;
    const answerL = (text: string) => localizeText(answerDictionary, text);
    const acceptFor = (answer: string, accept: string[]) => answerDictionary?.accept.get(answer)?.slice(1) ?? accept;
    quizmaster = {
      answer369: q ? answerL(q.data.answer) : null,
      puzzleGroups: p
        ? p.data.groups.map((group, i) => ({
            answer: answerL(group.answer),
            accept: acceptFor(group.answer, group.accept),
            clues: group.clues.map(L),
            found: room.puzzle!.found[i],
          }))
        : null,
      answers:
        gridRound && gridItem
          ? gridItem.answers
              .slice(0, gridRound.count)
              .map((a, i) => ({ text: answerL(a.text), accept: acceptFor(a.text, a.accept), found: gridRound.round.found[i] }))
          : null,
      galleryAnswer: galleryEntry ? answerL(galleryEntry.answer) : null,
    };
  }

  const personalRanking =
    room.teamMode && room.phase === "FINISHED"
      ? room.contestants
          .flatMap((c) => c.members)
          .map((userId) => ({ userId, name: nameOf(room, userId), points: room.personal.get(userId) ?? 0 }))
          .sort((a, b) => b.points - a.points)
      : null;

  return {
    code: room.code,
    phase: room.phase,
    me: {
      userId: viewerId,
      role: viewer?.role ?? "spectator",
      isHost: room.hostId === viewerId,
      contestantId: myContestant?.id ?? null,
      actsForContestant: myContestant?.leaderId === viewerId,
      language: room.languages.get(viewerId) ?? DEFAULT_LANGUAGE,
    },
    hostId: room.hostId,
    quizmasterId: room.quizmasterId,
    length: room.length,
    teamMode: room.teamMode,
    lobbyTeams: room.teamMode ? room.lobbyTeams.map((t, i) => ({ name: AK_TEAM_NAMES[i], leaderId: t.leaderId })) : null,
    participants: [...room.participants.values()].map((p) => ({
      userId: p.userId,
      name: p.name,
      role: p.role,
      online: (room.sockets.get(p.userId)?.size ?? 0) > 0,
      teamIndex: room.teamMode ? p.team : null,
    })),
    contestants: room.contestants.map((c) => ({
      id: c.id,
      name: c.name,
      seconds: Math.round(secondsOf(room, c.id) * 10) / 10,
      color: c.color,
      leaderId: c.leaderId,
      members: c.members.map((userId) => ({ userId, name: nameOf(room, userId) })),
    })),
    finalists: room.finale && (room.phase === "FINALE" || room.phase === "FINISHED") ? room.finale.finalists : null,
    activeId: room.activeId,
    clockRunning: room.clockRunning,
    turnDeadline: room.turnDeadline,
    serverNow: Date.now(),
    round: { number: room.roundIndex + 1, total: room.rounds.length },
    intermission: room.intermission,
    r369,
    openDeur,
    puzzle,
    gallery,
    memory,
    finale,
    quizmaster,
    winnerId: room.winnerId,
    season: room.season
      ? {
          seasonId: room.season.seasonId,
          isFinale: room.season.isFinale,
          isLast: room.season.isLast,
          lineup: room.season.lineup.map((userId) => ({ userId, name: room.season!.names[userId] ?? nameOf(room, userId) })),
          safeId: room.season.safeId,
        }
      : null,
    personal: room.teamMode
      ? { mine: myContestant ? (room.personal.get(viewerId) ?? 0) : null, ranking: personalRanking }
      : null,
    solo: room.solo
      ? { mode: room.solo.mode, xpEarned: room.solo.result?.xpEarned ?? null, rank: room.solo.result?.rank ?? null }
      : null,
    feedback: room.feedback ? { ...room.feedback, text: localizeFeedback(dictionary, room.feedback.text) } : null,
  };
}

function broadcast(room: Room) {
  room.lastBroadcast = Date.now();
  if (!io) return;
  for (const userId of room.participants.keys()) {
    io.to(`user:${userId}`).emit("ak:state", buildView(room, userId));
  }
}

// --- Klok en geplande stappen -----------------------------------------------

function ensureTicking(room: Room) {
  if (room.timer) return;
  room.lastTick = Date.now();
  room.timer = setInterval(() => tick(room), TICK_MS);
}

function tick(room: Room) {
  const now = Date.now();
  const elapsed = now - room.lastTick;
  room.lastTick = now;

  if (room.clockRunning && room.activeId) {
    const remaining = secondsOf(room, room.activeId) - elapsed / 1000;
    room.seconds.set(room.activeId, Math.max(0, remaining));
    if (remaining <= 0) onClockZero(room);
  }
  if (room.turnDeadline !== null && now >= room.turnDeadline) {
    room.turnDeadline = null;
    onTurnTimeout(room);
  }
  if (room.pending && now >= room.pending.at) {
    const { run } = room.pending;
    room.pending = null;
    run();
    broadcast(room);
    return;
  }
  const live = room.clockRunning || room.turnDeadline !== null || room.pending !== null;
  if (live && now - room.lastBroadcast >= BROADCAST_EVERY_MS) broadcast(room);
}

function onClockZero(room: Room) {
  const active = room.activeId;
  if (!active) return;
  room.clockRunning = false;
  if (room.phase === "FINALE" && room.finale) {
    const [a, b] = room.finale.finalists;
    finish(room, active === a ? b : a);
    return;
  }
  feedback(room, active, "Je seconden zijn op", "bad");
  endTurn(room);
  broadcast(room);
}

function onTurnTimeout(room: Room) {
  if (room.phase === "R369" && room.r369?.listening) startThinking369(room);
  else if (room.phase === "R369") answer369(room, false, "De tijd is om");
  else if (room.phase === "PUZZLE") endPuzzleTurn(room);
  else if (room.phase === "OPEN_DEUR" && room.openDeur?.choosing) {
    chooseDoor(room, room.openDeur.taken.findIndex((t) => !t));
  } else if (room.phase === "MEMORY" && room.memory?.reading) startMemoryAnswering(room);
  broadcast(room);
}

/** Beurt beëindigen (passen, klok op nul) in de ronde die nu loopt. */
function endTurn(room: Room) {
  if (room.phase === "R369") answer369(room, false, "Gepast");
  else if (room.phase === "PUZZLE") endPuzzleTurn(room);
  else if (room.phase === "OPEN_DEUR" && room.openDeur && !room.openDeur.choosing) endGridTurn(room, room.openDeur);
  else if (room.phase === "MEMORY" && room.memory && !room.memory.reading) endGridTurn(room, room.memory);
  else if (room.phase === "FINALE" && room.finale) endGridTurn(room, room.finale);
  else if (room.phase === "GALLERY") endGalleryTurn(room);
}

// --- Start ------------------------------------------------------------------

function buildContestants(room: Room): Contestant[] | string {
  const players = lobbyPlayers(room);
  if (room.season) {
    const missing = room.season.lineup.filter((id) => !players.some((p) => p.userId === id));
    if (missing.length > 0) {
      return `Wacht tot iedereen van deze avond er is: ${missing.map((id) => room.season!.names[id] ?? "speler").join(", ")}.`;
    }
    return room.season.lineup.map((id, i) => ({ id, name: nameOf(room, id), members: [id], leaderId: id, color: i }));
  }
  if (!room.teamMode) {
    if (players.length < AK_MIN_PLAYERS) return `Er zijn minstens ${AK_MIN_PLAYERS} spelers nodig.`;
    return players.map((p, i) => ({ id: p.userId, name: p.name, members: [p.userId], leaderId: p.userId, color: i }));
  }
  if (players.length < AK_MIN_TEAM_PLAYERS) return `Teams kan vanaf ${AK_MIN_TEAM_PLAYERS} spelers.`;
  normalizeTeams(room);
  const teams = room.lobbyTeams
    .map((team, index) => ({
      id: `team-${index}`,
      name: AK_TEAM_NAMES[index],
      members: players.filter((p) => p.team === index).map((p) => p.userId),
      leaderId: team.leaderId ?? "",
      color: index,
    }))
    .filter((t) => t.members.length > 0);
  if (teams.length < 2) return "Verdeel de spelers over minstens twee teams.";
  return teams;
}

function gridItem(
  id: string,
  subject: string,
  answers: TopicAnswer[],
  distractors: string[],
  answerCount: number,
  size: number,
  tapOnly = false
): GridItem {
  const used = answers.slice(0, answerCount);
  return {
    id,
    subject,
    answers: used,
    grid: shuffle([...used.map((a) => a.text), ...shuffle(distractors).slice(0, size - used.length)]),
    tapOnly,
  };
}

function emptyGridRound(items: GridItem[]): GridRound {
  return { items, index: -1, found: [], foundOrder: [], wrong: new Set(), queue: [], revealed: false, picks: new Map() };
}

async function buildGallery(id: string, data: GalleryData) {
  const entries: GalleryEntry[] = [];
  if (data.variant === "QUOTES") {
    const books = await siblingBookNames(bookOfRef(data.refs[0]) ?? "");
    for (const ref of data.refs) {
      const answer = bookOfRef(ref);
      const text = await verseTextByRef(ref);
      if (!answer || !text) continue;
      const pool = books.length >= 4 ? books : data.refs.map((r) => bookOfRef(r) ?? "").filter(Boolean);
      const others = shuffle([...new Set(pool)].filter((b) => b !== answer)).slice(0, 3);
      entries.push({ text, image: null, answer, options: shuffle([answer, ...others]) });
    }
  } else {
    const stories = data.stories
      .map((s) => ({ story: kidsStory(s.number), image: s.image }))
      .filter((s): s is { story: { title: string; images: string[] }; image: number } => Boolean(s.story?.images[s.image]));
    for (const { story, image } of stories) {
      const others = shuffle(stories.map((s) => s.story.title).filter((t) => t !== story.title)).slice(0, 3);
      entries.push({ text: null, image: story.images[image], answer: story.title, options: shuffle([story.title, ...others]) });
    }
  }
  return { id, variant: data.variant, entries };
}

/**
 * Woordenboeken per speltaal voor de gekozen onderdelen. Verzen (luistervraag,
 * citaten, passage) komen uit de uitgave van die taal: dezelfde verwijzing,
 * de tekst zoals die daar staat.
 */
async function buildDictionaries(room: Room, content: GameContent) {
  room.dictionaries = new Map();
  const languages = roomLanguages(room);
  if (languages.length === 0) return;
  const items: { id: string; kind: AlleskennerItemKind; data: unknown }[] = [
    ...content.questions.map((i) => ({ ...i, kind: "QUESTION" as const })),
    ...[...content.doors, ...content.finaleTopics].map((i) => ({ ...i, kind: "TOPIC" as const })),
    ...content.puzzles.map((i) => ({ ...i, kind: "PUZZLE" as const })),
    ...content.galleries.map((i) => ({ ...i, kind: "GALLERY" as const })),
    ...content.memories.map((i) => ({ ...i, kind: "MEMORY" as const })),
  ];
  const translations = await itemTranslations(
    items.map((i) => i.id),
    languages
  );
  for (const language of languages) {
    const dictionary = emptyDictionary();
    const collectionId = await editionCollectionId(language);
    for (const [nl, own] of await bookNamePairs(collectionId)) addPair(dictionary, nl, own);
    for (const item of items) {
      const translated = translations.get(language)?.get(item.id);
      if (!translated) continue;
      addItemPairs(dictionary, item.kind, item.data, translated);
      if (item.kind === "QUESTION") {
        const nl = item.data as QuestionData;
        const own = translated as QuestionData;
        if (nl.listen && own.listen) {
          addPair(dictionary, await verseTextByRef(nl.listen.ref), await verseTextByRef(own.listen.ref, collectionId));
        }
      } else if (item.kind === "GALLERY") {
        const nl = item.data as GalleryData;
        const own = translated as GalleryData;
        if (nl.variant === "QUOTES" && own.variant === "QUOTES") {
          for (let i = 0; i < nl.refs.length; i++) {
            addPair(dictionary, await verseTextByRef(nl.refs[i]), own.refs[i] ? await verseTextByRef(own.refs[i], collectionId) : null);
          }
        }
      } else if (item.kind === "MEMORY") {
        const nl = item.data as MemoryData;
        const own = translated as MemoryData;
        if (!nl.readText && !own.readText) {
          const [nlVerses, ownVerses] = await Promise.all([passageVerses(nl.passage), passageVerses(own.passage, collectionId)]);
          nlVerses.forEach((verse, i) => addPair(dictionary, verse.text, ownVerses[i]?.text));
        }
      }
    }
    room.dictionaries.set(language, dictionary);
  }
}

interface GameContent {
  questions: PickedItem<"QUESTION">[]; // in speelvolgorde
  doors: PickedItem<"TOPIC">[];
  puzzles: PickedItem<"PUZZLE">[];
  galleries: PickedItem<"GALLERY">[];
  memories: PickedItem<"MEMORY">[];
  finaleTopics: PickedItem<"TOPIC">[];
}

async function startGame(room: Room): Promise<string | null> {
  const contestants = buildContestants(room);
  if (typeof contestants === "string") return contestants;
  const n = contestants.length;
  const full = room.length === "FULL";

  await ensureAlleskennerContent();
  // Speltaal van iedereen die er nu is; spelen er mensen in een andere taal
  // mee, dan kiezen we alleen onderdelen die ook in hun taal bestaan.
  await assignLanguages(room, [...room.participants.keys()]);
  const languages = roomLanguages(room);
  // Binnen een seizoen komt niets terug: alle leden tellen mee, ook wie er vanavond niet is.
  const everyone = [...new Set([...room.participants.keys(), ...(room.season?.memberIds ?? [])])];
  const listen = await pickItems("QUESTION", 1, everyone, (d) => Boolean(d.listen), languages);
  const normal = await pickItems("QUESTION", QUESTIONS_369 - listen.length, everyone, (d) => !d.listen, languages);
  if (normal.length + listen.length < 3) return "Er zijn nog te weinig vragen om te spelen.";
  // Handgeschreven vragen komen bij het kiezen voorop (zie pickItems); de
  // volgorde in het spel zelf is willekeurig.
  const questions = shuffle(normal);
  // De luistervraag nooit als eerste: dan is iedereen er nog niet klaar voor.
  if (listen[0]) questions.splice(1 + Math.floor(Math.random() * Math.max(1, questions.length - 1)), 0, listen[0]);

  const puzzles = await pickItems("PUZZLE", n, everyone, undefined, languages);
  const topics = await pickItems("TOPIC", (full ? n : 0) + FINALE_TOPICS, everyone, (d) => d.answers.length >= FINALE_ANSWERS, languages);
  // Open Deur krijgt één onderwerp per deelnemer, maar de finale gaat voor:
  // die houdt er altijd minstens drie over.
  const doorCount = full ? Math.min(n, Math.max(0, topics.length - 3)) : 0;
  const doors = topics.slice(0, doorCount);
  const finaleTopics = topics.slice(doorCount, doorCount + FINALE_TOPICS);
  if (finaleTopics.length === 0) return "Er zijn nog geen onderwerpen voor de finale.";
  const galleries = full ? await pickItems("GALLERY", n, everyone, undefined, languages) : [];
  const memories = full ? await pickItems("MEMORY", n, everyone, undefined, languages) : [];

  await markSeen([...questions, ...puzzles, ...doors, ...finaleTopics, ...galleries, ...memories].map((i) => i.id), everyone);
  await setupGame(room, contestants, { questions, doors, puzzles, galleries, memories, finaleTopics });

  await prisma.liveGame.update({ where: { id: room.gameId }, data: { status: "IN_PROGRESS" } }).catch(() => {});
  await revokeOpenInvites(room).catch(() => {});
  return null;
}

/** Zet de gekozen inhoud klaar en begint de eerste ronde (quizavond én alleen spelen). */
async function setupGame(room: Room, contestants: Contestant[], content: GameContent) {
  const { questions, doors, puzzles, galleries, memories, finaleTopics } = content;
  room.r369 = {
    items: await Promise.all(
      questions.map(async (q) => ({
        id: q.id,
        // In het inhoudsbestand staat het goede antwoord meestal voorop;
        // per spel schudden, net als bij de andere oefeningen in de app.
        data: { ...q.data, options: shuffle(q.data.options) },
        listenText: q.data.listen ? await verseTextByRef(q.data.listen.ref) : null,
      }))
    ),
    index: 0,
    reveal: null,
    picks: new Map(),
    starter: null,
    attempted: [],
    wrongOptions: [],
    listening: false,
  };
  room.openDeur = {
    ...emptyGridRound(
      doors.map((t) =>
        gridItem(t.id, t.data.subject, t.data.answers, t.data.distractors, OPEN_DEUR_ANSWERS, OPEN_DEUR_GRID_SIZE, t.data.tapOnly)
      )
    ),
    owners: [],
    taken: doors.map(() => false),
    choosing: false,
  };
  room.puzzle = {
    items: puzzles.map((p) => ({
      id: p.id,
      data: p.data,
      clues: shuffle(p.data.groups.flatMap((g, group) => g.clues.map((text) => ({ text, group })))),
    })),
    index: -1,
    found: [],
    queue: [],
    owners: [],
    revealed: false,
    picks: new Map(),
    guesses: new Map(),
  };
  const galleryItems = (await Promise.all(galleries.map((g) => buildGallery(g.id, g.data)))).filter((g) => g.entries.length > 0);
  room.gallery = {
    items: galleryItems,
    index: -1,
    owners: [],
    found: [],
    queue: [],
    turnEntries: [],
    turnPos: 0,
    revealed: false,
    picks: new Map(),
  };
  const memoryItems: GridItem[] = [];
  for (const m of memories) {
    // Een hoofdstukkop (readText) wordt als één tekst getoond, zonder versnummer.
    const verses = m.data.readText ? [{ number: 0, text: m.data.readText }] : await passageVerses(m.data.passage);
    if (verses.length === 0) continue;
    memoryItems.push({
      ...gridItem(m.id, m.data.title, m.data.answers, m.data.distractors, MEMORY_ANSWERS, GRID_SIZE),
      passage: m.data.passage,
      verses,
    });
  }
  room.memory = { ...emptyGridRound(memoryItems), owners: [], reading: false };
  await buildDictionaries(room, content);
  // Een finale heeft twee deelnemers nodig; alleen spelen heeft er geen.
  room.finale =
    contestants.length >= 2 && finaleTopics.length > 0
      ? {
          ...emptyGridRound(
            finaleTopics.map((t) =>
              gridItem(t.id, t.data.subject, t.data.answers, t.data.distractors, FINALE_ANSWERS, GRID_SIZE, t.data.tapOnly)
            )
          ),
          finalists: [contestants[0].id, contestants[1].id],
        }
      : null;

  room.contestants = contestants;
  room.seconds = new Map(contestants.map((c) => [c.id, AK_START_SECONDS]));
  room.personal = new Map();
  // Rondes zonder inhoud (bv. nog geen galerijen in de database) vallen weg.
  room.rounds = AK_ROUNDS[room.length].filter(
    (phase) =>
      (phase !== "OPEN_DEUR" || room.openDeur!.items.length > 0) &&
      (phase !== "PUZZLE" || room.puzzle!.items.length > 0) &&
      (phase !== "GALLERY" || room.gallery!.items.length > 0) &&
      (phase !== "MEMORY" || room.memory!.items.length > 0) &&
      (phase !== "FINALE" || room.finale !== null)
  );
  room.roundIndex = -1;
  nextRound(room);
  ensureTicking(room);
}

// Uitgenodigden die niet zijn toegetreden: uitnodiging vervalt (zie InviteListener).
async function revokeOpenInvites(room: Room) {
  const invites = await prisma.liveGameInvite.findMany({ where: { gameId: room.gameId }, select: { userId: true } });
  for (const invite of invites) {
    if (!room.participants.has(invite.userId)) io?.to(`user:${invite.userId}`).emit("game_invite_revoked", { code: room.code });
  }
  // Gestart: de uitnodiging in het meldingencentrum is niet meer te gebruiken.
  await removeNotificationsByUrl(invites.map((i) => i.userId), `/live/${room.code}`).catch(() => {});
}

const ROUND_SUBTITLES: Partial<Record<AkPhase, string>> = {
  OPEN_DEUR: `Wie de minste seconden heeft, kiest als eerste een onderwerp. Vier antwoorden, elk +${AK_OPEN_DEUR_POINTS} seconden. Je klok loopt.`,
  PUZZLE: `Vind de drie groepen van vier. Elke groep +${AK_PUZZLE_POINTS} seconden. Je klok loopt.`,
  GALLERY: `Noem bij elk citaat het boek, of bij elke illustratie het verhaal. Elk goed antwoord +${AK_GALLERY_POINTS} seconden.`,
  MEMORY: `Lees de passage goed: je hebt ${AK_MEMORY_READ_MS / 1000} seconden. Daarna vijf antwoorden, elk volgend antwoord is meer waard.`,
};

function roundSubtitle(room: Room, phase: AkPhase): string {
  if (phase === "R369") {
    const total = room.r369?.items.length ?? QUESTIONS_369;
    const points = Array.from({ length: Math.floor(total / 3) }, (_, i) => String((i + 1) * 3));
    const list = points.length > 1 ? `${points.slice(0, -1).join(", ")} en ${points[points.length - 1]}` : (points[0] ?? "");
    return `${room.solo ? "Je begint" : "Iedereen begint"} met ${AK_START_SECONDS} seconden. Punten bij vraag ${list}.`;
  }
  if (phase === "OPEN_DEUR" && room.solo) {
    return `Kies een onderwerp en vind vier antwoorden, elk +${AK_OPEN_DEUR_POINTS} seconden. Je klok loopt.`;
  }
  return ROUND_SUBTITLES[phase] ?? "";
}

function nextRound(room: Room) {
  room.roundIndex++;
  room.activeId = null;
  room.clockRunning = false;
  room.turnDeadline = null;
  const phase = room.rounds[room.roundIndex];
  if (!phase) {
    finish(room, byMostSeconds(room, contestantIds(room))[0] ?? null);
    return;
  }
  if (phase === "FINALE") {
    beginFinale(room);
    return;
  }
  room.phase = phase;
  room.intermission = {
    title: `Ronde ${room.roundIndex + 1}: ${AK_ROUND_TITLES[phase]}`,
    subtitle: roundSubtitle(room, phase),
    standings: room.roundIndex > 0,
  };
  schedule(room, INTERMISSION_MS, () => {
    room.intermission = null;
    if (phase === "R369") {
      room.activeId = room.contestants[0].id;
      ask369(room);
    } else if (phase === "OPEN_DEUR") nextDoor(room);
    else if (phase === "PUZZLE") nextPuzzle(room);
    else if (phase === "GALLERY") nextGallery(room);
    else if (phase === "MEMORY") nextMemory(room);
  });
}

// --- 3-6-9 ----------------------------------------------------------------------

function ask369(room: Room) {
  const state = room.r369;
  if (!state) return;
  state.reveal = null;
  state.picks = new Map();
  state.starter = room.activeId;
  state.attempted = [];
  state.wrongOptions = [];
  room.clockRunning = false;
  // Luistervraag: de bedenktijd start pas als het vers is voorgelezen op het
  // apparaat van wie aan de beurt is (ak:listen_done). De deadline hier is
  // alleen een vangnet voor als dat bericht nooit komt (voorlezen geblokkeerd,
  // telefoon weggelegd).
  state.listening = state.items[state.index].listenText !== null;
  room.turnDeadline = Date.now() + (state.listening ? AK_LISTEN_MAX_MS : AK_369_THINK_MS);
}

function startThinking369(room: Room) {
  if (!room.r369?.listening) return;
  room.r369.listening = false;
  room.turnDeadline = Date.now() + AK_369_THINK_MS;
}

/** Eerstvolgende deelnemer (na de huidige) die deze vraag nog niet heeft geprobeerd. */
function nextUntried(room: Room, from: string): string | null {
  const state = room.r369!;
  const start = orderIndex(room, from);
  for (let step = 1; step < room.contestants.length; step++) {
    const id = room.contestants[(start + step) % room.contestants.length].id;
    if (!state.attempted.includes(id)) return id;
  }
  return null;
}

/**
 * Goed: punten (bij vraag 3, 6, 9, ...) en wie het goed had krijgt de
 * volgende vraag. Fout (ook passen of de tijd om): de vraag gaat naar de
 * volgende die hem nog niet heeft geprobeerd; weet niemand het, dan krijgt
 * wie de vraag als eerste kreeg de volgende vraag.
 */
function answer369(room: Room, correct: boolean, note?: string, wrongOption?: string) {
  const state = room.r369;
  const active = room.activeId;
  if (!state || state.reveal || !active) return;
  const number = state.index + 1;
  const answer = state.items[state.index].data.answer;
  const leader = leaderOfActive(room);
  room.turnDeadline = null;
  state.listening = false;

  if (correct) {
    // Met quizmaster antwoordt de teamleider hardop; zijn keuze is dan het goede antwoord.
    if (leader && room.quizmasterId) state.picks.set(leader, answer);
    if (number % 3 === 0) {
      addSeconds(room, active, AK_369_POINTS);
      feedback(room, active, `Goed! +${AK_369_POINTS} seconden`, "good");
    } else {
      feedback(room, active, "Goed! Je mag door", "good");
    }
    finish369Question(room, active, true);
    return;
  }

  if (leader && room.quizmasterId) state.picks.set(leader, "");
  if (wrongOption && !state.wrongOptions.includes(wrongOption)) state.wrongOptions.push(wrongOption);
  state.attempted.push(active);
  const next = nextUntried(room, active);
  if (next) {
    feedback(room, active, `${note ?? "Fout"} — ${contestantName(room, next)} mag het proberen`, "bad");
    room.activeId = null;
    schedule(room, BETWEEN_TURNS_MS, () => {
      room.activeId = next;
      room.turnDeadline = Date.now() + AK_369_THINK_MS;
    });
    return;
  }
  feedback(room, active, room.contestants.length === 1 ? (note ?? "Fout") : `${note ?? "Fout"} — niemand wist het`, "bad");
  finish369Question(room, state.starter ?? active, false);
}

/** Onthullen, persoonlijke punten verdelen en de volgende vraag aan `nextActive`. */
function finish369Question(room: Room, nextActive: string, correct: boolean) {
  const state = room.r369!;
  const answer = state.items[state.index].data.answer;
  state.reveal = { correct };
  // Persoonlijke punten (teams): elke keuze die het goede antwoord was. De
  // tik van een teamleider namens zijn team telt ook als zijn eigen keuze.
  for (const [userId, pick] of state.picks) {
    if (pick === answer) addPersonal(room, userId, 1);
  }
  room.activeId = null;
  schedule(room, REVEAL_369_MS, () => {
    state.index++;
    if (state.index >= state.items.length) {
      nextRound(room);
      return;
    }
    room.activeId = nextActive;
    ask369(room);
  });
}

// --- Gedeelde beurtlogica (Open Deur, Collectief Geheugen, Finale) --------------

function startGridItem(room: Room, round: GridRound, index: number, queue: string[]) {
  round.index = index;
  round.found = round.items[index].answers.map(() => false);
  round.foundOrder = [];
  round.wrong = new Set();
  round.revealed = false;
  round.picks = new Map();
  round.queue = queue;
  startGridTurn(room, round);
}

function startGridTurn(room: Room, round: GridRound) {
  // Wie geen seconden meer heeft, slaat zijn beurt over (behalve in de finale:
  // daar is 0 seconden al het einde van het spel).
  let next = round.queue.shift();
  while (next && room.phase !== "FINALE" && secondsOf(room, next) <= 0) next = round.queue.shift();
  if (!next) {
    revealGrid(room, round);
    return;
  }
  room.activeId = next;
  room.clockRunning = true;
  room.turnDeadline = null;
}

function gridFound(room: Room, round: GridRound, index: number) {
  const active = room.activeId;
  if (!active || round.revealed || round.found[index] === undefined || round.found[index]) return;
  round.found[index] = true;
  const text = round.items[round.index].answers[index].text;
  const leader = leaderOfActive(room);
  if (leader) {
    const picks = round.picks.get(leader) ?? new Set<string>();
    picks.add(text);
    round.picks.set(leader, picks);
  }

  if (room.phase === "FINALE" && room.finale) {
    round.foundOrder.push({ index, value: AK_FINALE_PENALTY });
    const [a, b] = room.finale.finalists;
    const opponent = active === a ? b : a;
    addSeconds(room, opponent, -AK_FINALE_PENALTY);
    feedback(room, active, `Goed! ${contestantName(room, opponent)} −${AK_FINALE_PENALTY} seconden`, "good");
    if (secondsOf(room, opponent) <= 0) {
      finish(room, active);
      return;
    }
  } else {
    const value = room.phase === "MEMORY" ? (round.foundOrder.length + 1) * AK_MEMORY_STEP : AK_OPEN_DEUR_POINTS;
    round.foundOrder.push({ index, value });
    addSeconds(room, active, value);
    feedback(room, active, `${text}! +${value} seconden`, "good");
  }
  if (round.found.every(Boolean)) endGridTurn(room, round);
}

function gridWrong(room: Room, round: GridRound, text: string) {
  const active = room.activeId;
  if (!active) return;
  round.wrong.add(text);
  const leader = leaderOfActive(room);
  if (leader) {
    const picks = round.picks.get(leader) ?? new Set<string>();
    picks.add(text);
    round.picks.set(leader, picks);
  }
  feedback(room, active, "Fout! De beurt is voorbij", "bad");
  endGridTurn(room, round);
}

function endGridTurn(room: Room, round: GridRound) {
  if (room.pending || round.revealed) return;
  room.clockRunning = false;
  room.activeId = null;
  if (!round.found.every(Boolean) && round.queue.length > 0) {
    schedule(room, BETWEEN_TURNS_MS, () => startGridTurn(room, round));
    return;
  }
  revealGrid(room, round);
}

function revealGrid(room: Room, round: GridRound) {
  room.clockRunning = false;
  room.activeId = null;
  round.revealed = true;
  const answers = new Set(round.items[round.index].answers.map((a) => a.text));
  for (const [userId, picks] of round.picks) {
    addPersonal(room, userId, [...picks].filter((t) => answers.has(t)).length);
  }
  schedule(room, REVEAL_ROUND_ITEM_MS, () => {
    if (room.phase === "OPEN_DEUR") nextDoor(room);
    else if (room.phase === "MEMORY" && room.solo) nextMemory(room);
    else if (room.phase === "MEMORY") {
      // Tussenstand na elk fragment.
      room.intermission = { title: "Tussenstand", subtitle: standingsText(room), standings: true };
      schedule(room, STANDINGS_MS, () => {
        room.intermission = null;
        nextMemory(room);
      });
    } else if (room.phase === "FINALE") nextTopic(room);
  });
}

function silentGridPick(room: Room, round: GridRound, userId: string, text: string, answerCount: number) {
  const item = round.items[round.index];
  if (round.revealed || !item.grid.includes(text) || round.wrong.has(text)) return;
  const answerIndex = item.answers.findIndex((a) => a.text === text);
  if (answerIndex >= 0 && round.found[answerIndex]) return;
  const picks = round.picks.get(userId) ?? new Set<string>();
  if (picks.has(text)) picks.delete(text);
  else if (picks.size < answerCount) picks.add(text);
  round.picks.set(userId, picks);
}

// --- Open Deur -----------------------------------------------------------------

function nextDoor(room: Room) {
  const state = room.openDeur!;
  const waiting = contestantIds(room).filter((id) => !state.owners.includes(id));
  const free = state.taken.filter((t) => !t).length;
  if (waiting.length === 0 || free === 0) {
    nextRound(room);
    return;
  }
  const chooser = byFewestSeconds(room, waiting)[0];
  state.owners.push(chooser);
  state.choosing = true;
  state.index = -1;
  state.revealed = false;
  room.activeId = chooser;
  room.clockRunning = false;
  room.turnDeadline = Date.now() + CHOOSE_DOOR_MS;
  // De laatste deur hoeft niet gekozen te worden.
  if (free === 1) chooseDoor(room, state.taken.findIndex((t) => !t));
}

function chooseDoor(room: Room, door: number) {
  const state = room.openDeur;
  if (!state || !state.choosing || door < 0 || state.taken[door] !== false || !room.activeId) return;
  const owner = room.activeId;
  state.taken[door] = true;
  state.choosing = false;
  // Onderwerp meteen tonen; de beurt begint na een korte pauze.
  state.index = door;
  state.found = state.items[door].answers.map(() => false);
  state.foundOrder = [];
  state.wrong = new Set();
  state.picks = new Map();
  room.turnDeadline = null;
  feedback(room, owner, `Kiest: ${state.items[door].subject}`, "info");
  room.activeId = null;
  schedule(room, BETWEEN_TURNS_MS, () =>
    startGridItem(room, state, door, [owner, ...byFewestSeconds(room, contestantIds(room).filter((id) => id !== owner))])
  );
}

// --- Puzzel --------------------------------------------------------------------

function nextPuzzle(room: Room) {
  const state = room.puzzle!;
  state.index++;
  if (state.index >= state.items.length) {
    nextRound(room);
    return;
  }
  const candidates = contestantIds(room).filter((id) => !state.owners.includes(id));
  const owner = byFewestSeconds(room, candidates.length > 0 ? candidates : contestantIds(room))[0];
  state.owners.push(owner);
  state.found = [false, false, false];
  state.revealed = false;
  state.picks = new Map();
  state.guesses = new Map();
  state.queue = [owner, ...byFewestSeconds(room, contestantIds(room).filter((id) => id !== owner))];
  startPuzzleTurn(room, state.queue.shift()!);
}

function startPuzzleTurn(room: Room, id: string) {
  room.activeId = id;
  room.clockRunning = secondsOf(room, id) > 0;
  room.turnDeadline = Date.now() + AK_PUZZLE_TURN_MS;
  if (!room.clockRunning) endPuzzleTurn(room);
}

function puzzleFound(room: Room, group: number) {
  const state = room.puzzle;
  const active = room.activeId;
  if (!state || !active || state.revealed || state.found[group] === undefined || state.found[group]) return;
  state.found[group] = true;
  addSeconds(room, active, AK_PUZZLE_POINTS);
  const leader = leaderOfActive(room);
  if (leader) {
    const picks = state.picks.get(leader) ?? new Set<number>();
    picks.add(group);
    state.picks.set(leader, picks);
  }
  feedback(room, active, `${state.items[state.index].data.groups[group].answer}! +${AK_PUZZLE_POINTS} seconden`, "good");
  if (state.found.every(Boolean)) endPuzzleTurn(room);
}

function endPuzzleTurn(room: Room) {
  const state = room.puzzle;
  if (!state || room.pending || state.revealed) return;
  room.clockRunning = false;
  room.turnDeadline = null;
  const done = state.found.every(Boolean);
  const next = done ? undefined : state.queue.shift();
  room.activeId = null;
  if (next) {
    schedule(room, BETWEEN_TURNS_MS, () => startPuzzleTurn(room, next));
    return;
  }
  state.revealed = true;
  for (const [userId, groups] of state.picks) addPersonal(room, userId, groups.size);
  schedule(room, REVEAL_ROUND_ITEM_MS, () => nextPuzzle(room));
}

// --- Galerij -------------------------------------------------------------------

function nextGallery(room: Room) {
  const state = room.gallery!;
  const waiting = contestantIds(room).filter((id) => !state.owners.includes(id));
  state.index++;
  if (state.index >= state.items.length || waiting.length === 0) {
    nextRound(room);
    return;
  }
  const owner = byFewestSeconds(room, waiting)[0];
  state.owners.push(owner);
  state.found = state.items[state.index].entries.map(() => false);
  state.revealed = false;
  state.picks = new Map();
  state.queue = [owner, ...byFewestSeconds(room, contestantIds(room).filter((id) => id !== owner))];
  startGalleryTurn(room);
}

function startGalleryTurn(room: Room) {
  const state = room.gallery!;
  let next = state.queue.shift();
  while (next && secondsOf(room, next) <= 0) next = state.queue.shift();
  const open = state.found.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  if (!next || open.length === 0) {
    revealGallery(room);
    return;
  }
  state.turnEntries = open;
  state.turnPos = 0;
  room.activeId = next;
  room.clockRunning = true;
}

/** Antwoord op het onderdeel dat nu in beeld is; fout of passen = volgende. */
function galleryAnswer(room: Room, correct: boolean) {
  const state = room.gallery;
  const active = room.activeId;
  if (!state || !active || state.revealed) return;
  const entryIndex = state.turnEntries[state.turnPos];
  if (entryIndex === undefined) return;
  const entry = state.items[state.index].entries[entryIndex];
  const leader = leaderOfActive(room);
  if (leader) {
    const picks = state.picks.get(leader) ?? new Map<number, string>();
    picks.set(entryIndex, correct ? entry.answer : "");
    state.picks.set(leader, picks);
  }
  if (correct) {
    state.found[entryIndex] = true;
    addSeconds(room, active, AK_GALLERY_POINTS);
    feedback(room, active, `${entry.answer}! +${AK_GALLERY_POINTS} seconden`, "good");
  }
  state.turnPos++;
  if (state.turnPos >= state.turnEntries.length || state.found.every(Boolean)) endGalleryTurn(room);
}

function endGalleryTurn(room: Room) {
  const state = room.gallery;
  if (!state || room.pending || state.revealed) return;
  room.clockRunning = false;
  room.activeId = null;
  if (!state.found.every(Boolean) && state.queue.length > 0) {
    schedule(room, BETWEEN_TURNS_MS, () => startGalleryTurn(room));
    return;
  }
  revealGallery(room);
}

function revealGallery(room: Room) {
  const state = room.gallery!;
  room.clockRunning = false;
  room.activeId = null;
  state.revealed = true;
  const entries = state.items[state.index].entries;
  for (const [userId, picks] of state.picks) {
    addPersonal(room, userId, [...picks].filter(([i, pick]) => entries[i]?.answer === pick).length);
  }
  schedule(room, REVEAL_ROUND_ITEM_MS + 2000, () => nextGallery(room));
}

// --- Collectief Geheugen ---------------------------------------------------------

function nextMemory(room: Room) {
  const state = room.memory!;
  const waiting = contestantIds(room).filter((id) => !state.owners.includes(id));
  const index = state.index + 1;
  if (index >= state.items.length || waiting.length === 0) {
    nextRound(room);
    return;
  }
  const owner = byFewestSeconds(room, waiting)[0];
  state.owners.push(owner);
  state.index = index;
  state.found = state.items[index].answers.map(() => false);
  state.foundOrder = [];
  state.wrong = new Set();
  state.revealed = false;
  state.picks = new Map();
  state.queue = [];
  state.reading = true;
  room.activeId = null;
  room.clockRunning = false;
  room.turnDeadline = Date.now() + AK_MEMORY_READ_MS;
}

function startMemoryAnswering(room: Room) {
  const state = room.memory!;
  state.reading = false;
  room.turnDeadline = null;
  const owner = state.owners[state.owners.length - 1];
  startGridItem(room, state, state.index, [owner, ...byFewestSeconds(room, contestantIds(room).filter((id) => id !== owner))]);
}

// --- Finale -------------------------------------------------------------------

function beginFinale(room: Room) {
  const state = room.finale!;
  const ranked = byMostSeconds(room, contestantIds(room));
  let subtitle = `${contestantName(room, ranked[0])} tegen ${contestantName(room, ranked[1])}. Elk goed antwoord kost je tegenstander ${AK_FINALE_PENALTY} seconden.`;
  state.finalists = [ranked[0], ranked[1]];
  if (room.season) {
    room.season.afterRounds = ranked.map((userId) => ({ userId, seconds: secondsOf(room, userId) }));
    // Seizoensavond: de hoogste stand is De Slimste Heilige van de avond en is door;
    // de andere twee spelen om de laatste plek. Alleen op de laatste
    // finaleavond spelen de twee hoogsten om de titel.
    if (!room.season.isLast && ranked.length >= 3) {
      room.season.safeId = ranked[0];
      state.finalists = [ranked[1], ranked[2]];
      subtitle = `${contestantName(room, ranked[0])} is De Slimste Heilige van de avond! ${contestantName(room, ranked[1])} en ${contestantName(room, ranked[2])} spelen om de laatste plek; de verliezer ligt eruit.`;
    } else if (room.season.isLast) {
      subtitle = `${contestantName(room, ranked[0])} tegen ${contestantName(room, ranked[1])} om de titel De Slimste Heilige van het seizoen.`;
    }
  }
  room.phase = "FINALE";
  room.activeId = null;
  room.clockRunning = false;
  room.intermission = {
    title: room.season?.isLast ? "Seizoensfinale" : "Finale",
    subtitle,
    standings: true,
  };
  schedule(room, INTERMISSION_MS + 1000, () => {
    room.intermission = null;
    nextTopic(room);
  });
}

function nextTopic(room: Room) {
  const state = room.finale!;
  const index = state.index + 1;
  if (index >= state.items.length) {
    const [a, b] = state.finalists;
    finish(room, secondsOf(room, a) >= secondsOf(room, b) ? a : b);
    return;
  }
  startGridItem(room, state, index, byFewestSeconds(room, state.finalists));
}

// --- Einde --------------------------------------------------------------------

function finish(room: Room, winnerId: string | null) {
  room.phase = "FINISHED";
  room.winnerId = winnerId;
  room.activeId = null;
  room.clockRunning = false;
  room.turnDeadline = null;
  room.pending = null;
  room.intermission = null;
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  broadcast(room);

  if (room.solo) {
    recordSolo(room, room.solo, winnerId !== null);
    scheduleRoomCleanup(room);
    return;
  }
  prisma.liveGame.update({ where: { id: room.gameId }, data: { status: "FINISHED" } }).catch(() => {});
  if (room.season && room.finale) {
    const season = room.season;
    const record =
      winnerId && season.afterRounds.length > 0
        ? recordSeasonEvening(season.eveningId, { afterRounds: season.afterRounds, finalists: room.finale.finalists, winnerId })
        : cancelSeasonEvening(season.eveningId);
    record.catch((e) => console.error("Seizoensavond verwerken mislukt:", e));
  }
  for (const contestant of room.contestants) {
    for (const userId of contestant.members) {
      prisma.liveGamePlayer
        .updateMany({ where: { gameId: room.gameId, userId }, data: { score: Math.round(secondsOf(room, contestant.id)) } })
        .catch(() => {});
    }
  }
  scheduleRoomCleanup(room);
}

function scheduleRoomCleanup(room: Room) {
  setTimeout(() => {
    if (rooms.get(room.code) === room) rooms.delete(room.code);
  }, ROOM_TTL_AFTER_FINISH_MS);
}

/** Resultaat vastleggen (XP, reeks, klassement) en daarna nog één keer tonen. */
function recordSolo(room: Room, solo: NonNullable<Room["solo"]>, finished: boolean) {
  recordSoloRun(solo.runId, room.hostId, secondsOf(room, room.hostId), finished)
    .then((result) => {
      if (!result) return;
      solo.result = result;
      broadcast(room);
    })
    .catch((e) => console.error("De Slimste Heilige alleen: resultaat vastleggen mislukt:", e));
}

// --- Lobby: teams -----------------------------------------------------------------

/** Elke speler in een team, elk team een leider die er ook echt in zit. */
function normalizeTeams(room: Room) {
  if (!room.teamMode) return;
  const players = lobbyPlayers(room);
  const count = room.lobbyTeams.length;
  const sizes = Array.from({ length: count }, (_, i) => players.filter((p) => p.team === i).length);
  for (const p of players) {
    if (p.team !== null && p.team < count) continue;
    const smallest = sizes.indexOf(Math.min(...sizes));
    p.team = smallest;
    sizes[smallest]++;
  }
  for (const p of room.participants.values()) if (p.role !== "player") p.team = null;
  room.lobbyTeams.forEach((team, index) => {
    const members = players.filter((p) => p.team === index);
    if (!members.some((m) => m.userId === team.leaderId)) team.leaderId = members[0]?.userId ?? null;
  });
}

function setTeamCount(room: Room, count: number) {
  if (count === 0) {
    room.teamMode = false;
    room.lobbyTeams = [];
    for (const p of room.participants.values()) p.team = null;
    return;
  }
  room.teamMode = true;
  room.lobbyTeams = Array.from({ length: count }, () => ({ leaderId: null }));
  // Opnieuw eerlijk verdelen, om en om.
  lobbyPlayers(room).forEach((p, i) => (p.team = i % count));
  normalizeTeams(room);
}

// --- Aanmelden ----------------------------------------------------------------

// Een kamer wordt maar één keer opgebouwd, ook als meerdere spelers
// tegelijk binnenkomen: anders maakt ieder zijn eigen kamer aan en
// overschrijft de laatste de rest.
const loadingRooms = new Map<string, Promise<Room | string>>();

async function loadRoom(code: string): Promise<Room | string> {
  const game = await prisma.liveGame.findUnique({ where: { code }, select: { id: true, hostId: true, mode: true, status: true } });
  if (!game || game.mode !== "ALLESKENNER") return "Dit spel bestaat niet (meer).";
  if (game.status !== "LOBBY") return "Dit spel is al afgelopen.";
  const host = await prisma.user.findUnique({ where: { id: game.hostId }, select: { handle: true } });
  const evening = await prisma.alleskennerEvening.findUnique({
    where: { gameId: game.id },
    include: {
      season: {
        select: { hostId: true, deputyHostId: true, members: { select: { userId: true, user: { select: { handle: true } } } } },
      },
    },
  });
  const season: SeasonInfo | null = evening
    ? {
        eveningId: evening.id,
        seasonId: evening.seasonId,
        isFinale: evening.isFinale,
        isLast: evening.isLast,
        lineup: JSON.parse(evening.lineup) as string[],
        names: Object.fromEntries(evening.season.members.map((m) => [m.userId, m.user.handle])),
        memberIds: evening.season.members.map((m) => m.userId),
        managerIds: [evening.season.hostId, evening.season.deputyHostId].filter((id): id is string => id !== null),
        safeId: null,
        afterRounds: [],
      }
    : null;
  // Speelt de host zelf mee op deze avond, dan is er standaard geen quizmaster.
  const hostPlays = season?.lineup.includes(game.hostId) ?? false;
  const room = newRoom({
    code,
    gameId: game.id,
    season,
    solo: null,
    hostId: game.hostId,
    quizmasterId: hostPlays ? null : game.hostId,
    participants: new Map([
      [
        game.hostId,
        { userId: game.hostId, name: host?.handle ?? "Host", role: (hostPlays ? "player" : "quizmaster") as AkRole, team: null },
      ],
    ]),
    length: season ? "FULL" : "SHORT",
  });
  rooms.set(code, room);
  if (season) inviteSeasonMembers(room, host?.handle ?? "De host").catch(() => {});
  return room;
}

function newRoom(
  fields: Pick<Room, "code" | "gameId" | "season" | "solo" | "hostId" | "quizmasterId" | "participants" | "length">
): Room {
  return {
    ...fields,
    sockets: new Map(),
    teamMode: false,
    lobbyTeams: [],
    phase: "LOBBY",
    rounds: [],
    roundIndex: -1,
    contestants: [],
    seconds: new Map(),
    personal: new Map(),
    activeId: null,
    clockRunning: false,
    turnDeadline: null,
    intermission: null,
    pending: null,
    r369: null,
    openDeur: null,
    puzzle: null,
    gallery: null,
    memory: null,
    finale: null,
    winnerId: null,
    feedback: null,
    languages: new Map(),
    dictionaries: new Map(),
    starting: false,
    lastTick: Date.now(),
    lastBroadcast: 0,
    timer: null,
  };
}

// --- Alleen spelen ------------------------------------------------------------------

function soloCode(runId: string): string {
  return `SOLO-${runId}`;
}

/**
 * Een solokamer begint meteen: geen lobby. Na een herstart van de server is
 * een lopend potje weg; het begint dan opnieuw met dezelfde onderdelen (de
 * poging van de dag blijft dezelfde rij, zie startSoloRun).
 */
async function loadSoloRoom(runId: string, user: { id: string; handle: string; uiLanguage?: string | null }): Promise<Room | string> {
  const run = await prisma.alleskennerSoloRun.findUnique({ where: { id: runId } });
  if (!run || run.userId !== user.id) return "Dit spel bestaat niet (meer).";
  if (run.status !== "IN_PROGRESS") return "Dit spel is al afgelopen.";
  const items = JSON.parse(run.items) as SoloItems;
  const content: GameContent = {
    questions: await itemsByIds("QUESTION", items.questions),
    doors: await itemsByIds("TOPIC", items.doors),
    puzzles: await itemsByIds("PUZZLE", items.puzzles),
    galleries: await itemsByIds("GALLERY", items.galleries),
    memories: await itemsByIds("MEMORY", items.memories),
    finaleTopics: [],
  };
  if (content.questions.length === 0) return "De vragen van dit spel zijn niet meer beschikbaar.";
  const room = newRoom({
    code: soloCode(runId),
    gameId: "",
    season: null,
    solo: { runId, mode: run.mode, result: null },
    hostId: user.id,
    quizmasterId: null,
    participants: new Map([[user.id, { userId: user.id, name: user.handle, role: "player" as AkRole, team: null }]]),
    length: "SOLO",
  });
  await assignLanguages(room, [user.id]);
  await setupGame(room, [{ id: user.id, name: user.handle, members: [user.id], leaderId: user.id, color: 0 }], content);
  rooms.set(room.code, room);
  return room;
}

async function joinSoloRoom(socket: Socket, user: { id: string; handle: string; uiLanguage?: string | null }, runId: string): Promise<Room | string> {
  if (!(await canResumeGameContent("content_bom"))) return getT(user.uiLanguage)("gameAvailability.unavailable");
  const code = soloCode(runId);
  let room = rooms.get(code);
  if (!room) {
    let loading = loadingRooms.get(code);
    if (!loading) {
      loading = loadSoloRoom(runId, user).finally(() => loadingRooms.delete(code));
      loadingRooms.set(code, loading);
    }
    const loaded = await loading;
    if (typeof loaded === "string") return loaded;
    room = loaded;
  }
  if (room.hostId !== user.id) return "Dit spel bestaat niet (meer).";
  const sockets = room.sockets.get(user.id) ?? new Set<string>();
  sockets.add(socket.id);
  room.sockets.set(user.id, sockets);
  socket.data.akCode = code;
  return room;
}

// Bij een seizoensavond worden alle leden meteen uitgenodigd (spelers én
// toeschouwers): de melding bovenin als de app open staat, anders een push.
async function inviteSeasonMembers(room: Room, hostName: string) {
  for (const userId of room.season!.memberIds) {
    if (userId === room.hostId) continue;
    await prisma.liveGameInvite
      .upsert({ where: { gameId_userId: { gameId: room.gameId, userId } }, create: { gameId: room.gameId, userId }, update: {} })
      .catch(() => {});
    io?.to(`user:${userId}`).emit("game_invite", {
      code: room.code,
      fromDisplayName: hostName,
      fromUserId: room.hostId,
      gameLabel: "De Slimste Heilige",
    });
    // Altijd in het meldingencentrum; een push alleen als de app nergens open staat (zie notifyUser).
    notifyGameInvite(userId, hostName, (t) => t("pages.alleskenner"), room.code).catch(() => {});
  }
}

async function joinRoom(socket: Socket, user: { id: string; handle: string; uiLanguage?: string | null }, code: string): Promise<Room | string> {
  const upper = code.toUpperCase();
  if (!(await canResumeLiveGame(upper))) return getT(user.uiLanguage)("gameAvailability.unavailable");
  let room = rooms.get(upper);
  if (!room) {
    let loading = loadingRooms.get(upper);
    if (!loading) {
      loading = loadRoom(upper).finally(() => loadingRooms.delete(upper));
      loadingRooms.set(upper, loading);
    }
    const loaded = await loading;
    if (typeof loaded === "string") return loaded;
    room = loaded;
  }
  if (room.solo) return "Dit spel bestaat niet (meer).";

  if (!room.participants.has(user.id)) {
    if (!(await mayJoin(room, user.id))) return "Je bent niet uitgenodigd voor dit spel. Vraag de host om je uit te nodigen.";
    room.participants.set(user.id, {
      userId: user.id,
      name: user.handle,
      role: room.season ? (room.season.lineup.includes(user.id) && room.phase === "LOBBY" ? "player" : "spectator") : room.phase === "LOBBY" ? "player" : "spectator",
      team: null,
    });
    normalizeTeams(room);
    await prisma.liveGamePlayer
      .upsert({
        where: { gameId_userId: { gameId: room.gameId, userId: user.id } },
        create: { gameId: room.gameId, userId: user.id },
        update: {},
      })
      .catch(() => {});
  }
  if (!room.languages.has(user.id)) await assignLanguages(room, [user.id]);
  const sockets = room.sockets.get(user.id) ?? new Set<string>();
  sockets.add(socket.id);
  room.sockets.set(user.id, sockets);
  socket.data.akCode = upper;
  return room;
}

/**
 * Er is geen spelcode om in te vullen: binnenkomen kan alleen wie de host
 * heeft uitgenodigd (dus een vriend), of bij een seizoensavond een lid (of de
 * host/vervangende host) van het seizoen. Wie al eerder in dit spel zat, mag
 * terug, ook na een herstart van de server.
 */
async function mayJoin(room: Room, userId: string): Promise<boolean> {
  if (userId === room.hostId) return true;
  if (room.season && (room.season.memberIds.includes(userId) || room.season.managerIds.includes(userId))) return true;
  const [invite, player] = await Promise.all([
    prisma.liveGameInvite.findUnique({ where: { gameId_userId: { gameId: room.gameId, userId } }, select: { id: true } }),
    prisma.liveGamePlayer.findUnique({ where: { gameId_userId: { gameId: room.gameId, userId } }, select: { id: true } }),
  ]);
  return invite !== null || player !== null;
}

/** Aangeroepen vanuit cancel_game in gameServer.ts: de lobby is verwijderd. */
export function forgetAlleskennerRoom(code: string) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return;
  if (room.timer) clearInterval(room.timer);
  rooms.delete(room.code);
}

export function registerAlleskennerHandlers(server: SocketIOServer, socket: Socket, user: { id: string; handle: string; uiLanguage?: string | null }) {
  io = server;

  const current = (): Room | null => {
    const code = socket.data.akCode as string | undefined;
    return code ? (rooms.get(code) ?? null) : null;
  };
  const fail = (message: string) => socket.emit("ak:error", { message });

  socket.on("ak:join", async ({ code }: { code?: unknown }) => {
    if (typeof code !== "string") return;
    const result = await joinRoom(socket, user, code).catch(() => "Kon niet deelnemen aan dit spel.");
    if (typeof result === "string") {
      fail(result);
      return;
    }
    broadcast(result);
  });

  socket.on("ak:solo_join", async ({ runId }: { runId?: unknown }) => {
    if (typeof runId !== "string" || runId.length > 64) return;
    const result = await joinSoloRoom(socket, user, runId).catch((e) => {
      console.error("De Slimste Heilige alleen: starten mislukt:", e);
      return "Kon het spel niet starten.";
    });
    if (typeof result === "string") {
      fail(result);
      return;
    }
    broadcast(result);
  });

  socket.on("disconnect", () => {
    const room = current();
    if (!room) return;
    room.sockets.get(user.id)?.delete(socket.id);
    broadcast(room);
  });

  // Lobby: alleen de host, alleen vóór de start.
  const hostInLobby = (): Room | null => {
    const room = current();
    if (!room || room.hostId !== user.id || room.phase !== "LOBBY" || room.starting) return null;
    return room;
  };

  socket.on("ak:set_role", ({ userId, role }: { userId?: unknown; role?: unknown }) => {
    const room = hostInLobby();
    // Op een seizoensavond ligt de opstelling vast (gekozen op de seizoenspagina).
    if (!room || room.season || typeof userId !== "string" || (role !== "player" && role !== "spectator")) return;
    const participant = room.participants.get(userId);
    if (!participant) return;
    if (room.quizmasterId === userId) room.quizmasterId = null;
    participant.role = role;
    participant.team = null;
    normalizeTeams(room);
    broadcast(room);
  });

  socket.on("ak:set_quizmaster", ({ userId }: { userId?: unknown }) => {
    const room = hostInLobby();
    if (!room) return;
    if (typeof userId === "string" && room.season?.lineup.includes(userId)) return;
    if (room.quizmasterId) {
      const previous = room.participants.get(room.quizmasterId);
      if (previous) previous.role = room.season ? "spectator" : "player";
    }
    if (typeof userId === "string" && room.participants.has(userId)) {
      room.quizmasterId = userId;
      room.participants.get(userId)!.role = "quizmaster";
    } else {
      room.quizmasterId = null;
    }
    normalizeTeams(room);
    broadcast(room);
  });

  socket.on("ak:set_length", ({ length }: { length?: unknown }) => {
    const room = hostInLobby();
    if (!room || (length !== "SHORT" && length !== "FULL")) return;
    room.length = length;
    broadcast(room);
  });

  socket.on("ak:set_teams", ({ count }: { count?: unknown }) => {
    const room = hostInLobby();
    // Seizoenen zijn altijd individueel.
    if (!room || room.season || typeof count !== "number" || !Number.isInteger(count)) return;
    if (count !== 0 && (count < 2 || count > AK_MAX_TEAMS)) return;
    if (count > 0 && lobbyPlayers(room).length < AK_MIN_TEAM_PLAYERS) {
      fail(`Teams kan vanaf ${AK_MIN_TEAM_PLAYERS} spelers.`);
      return;
    }
    setTeamCount(room, count);
    broadcast(room);
  });

  socket.on("ak:set_team", ({ userId, team }: { userId?: unknown; team?: unknown }) => {
    const room = hostInLobby();
    if (!room || !room.teamMode || typeof userId !== "string" || typeof team !== "number") return;
    const participant = room.participants.get(userId);
    if (!participant || participant.role !== "player" || team < 0 || team >= room.lobbyTeams.length) return;
    participant.team = team;
    normalizeTeams(room);
    broadcast(room);
  });

  socket.on("ak:set_leader", ({ userId }: { userId?: unknown }) => {
    const room = hostInLobby();
    if (!room || !room.teamMode || typeof userId !== "string") return;
    const participant = room.participants.get(userId);
    if (!participant || participant.team === null) return;
    room.lobbyTeams[participant.team].leaderId = userId;
    broadcast(room);
  });

  socket.on("ak:start", async () => {
    const room = hostInLobby();
    // Starten kiest en registreert inhoud (async): een tweede tik mag niet
    // intussen een tweede start beginnen.
    if (!room) return;
    room.starting = true;
    const error = await startGame(room).catch((e) => {
      console.error("De Slimste Heilige starten mislukt:", e);
      return "Kon het spel niet starten.";
    });
    room.starting = false;
    if (error) fail(error);
    broadcast(room);
  });

  // Een deelnemer (niet de host) verlaat zelf de lobby; tegenhanger van
  // leave_game in gameServer.ts, want deze kamers staan in een eigen map.
  socket.on("ak:leave", async () => {
    const room = current();
    if (!room || room.solo || room.phase !== "LOBBY" || room.hostId === user.id) return;
    if (room.quizmasterId === user.id) room.quizmasterId = null;
    room.participants.delete(user.id);
    for (const socketId of room.sockets.get(user.id) ?? []) {
      const participantSocket = io?.sockets.sockets.get(socketId);
      if (participantSocket?.data.akCode === room.code) participantSocket.data.akCode = undefined;
    }
    room.sockets.delete(user.id);
    normalizeTeams(room);
    await prisma.liveGamePlayer
      .deleteMany({ where: { gameId: room.gameId, userId: user.id } })
      .catch(() => {});
    broadcast(room);
    io?.to(`user:${user.id}`).emit("game_left", { code: room.code });
  });

  socket.on("ak:stop", () => {
    const room = current();
    if (!room || room.hostId !== user.id || room.phase === "LOBBY" || room.phase === "FINISHED") return;
    finish(room, null);
  });

  // Tijdens het spel. Tikken en passen alleen door wie namens de deelnemer
  // aan de beurt handelt; beoordelen alleen door de quizmaster; stil
  // meekiezen door de andere teamspelers.
  const activeRoom = (): Room | null => {
    const room = current();
    if (!room || room.pending || room.intermission) return null;
    return room;
  };
  const isQuizmaster = (room: Room) => room.quizmasterId === user.id;

  socket.on("ak:pass", () => {
    const room = activeRoom();
    if (!room || !room.activeId) return;
    if (!(isQuizmaster(room) || leaderOfActive(room) === user.id)) return;
    if (room.phase === "GALLERY") galleryAnswer(room, false);
    else if (room.phase === "OPEN_DEUR" && room.openDeur?.choosing) return;
    else endTurn(room);
    broadcast(room);
  });

  socket.on("ak:tap_369", ({ option: tapped }: { option?: unknown }) => {
    const room = activeRoom();
    if (!room || room.phase !== "R369" || typeof tapped !== "string" || !room.r369 || room.r369.reveal) return;
    const current369 = room.r369.items[room.r369.index];
    // Getikt in de eigen taal; het spel rekent met de Nederlandse optie.
    const option = canonicalText(dictionaryFor(room, user.id), tapped);
    if (!current369.data.options.includes(option)) return;
    const kind = actorKind(room, user.id);
    if (kind === "team") {
      if (room.r369.wrongOptions.includes(option)) return;
      room.r369.picks.set(user.id, option);
      const correct = option === current369.data.answer;
      answer369(room, correct, undefined, correct ? undefined : option);
    } else if (kind === "silent") {
      room.r369.picks.set(user.id, option);
    }
    broadcast(room);
  });

  socket.on("ak:type_puzzle", ({ text }: { text?: unknown }) => {
    const room = activeRoom();
    if (!room || room.phase !== "PUZZLE" || typeof text !== "string" || !room.puzzle || room.puzzle.revealed) return;
    const state = room.puzzle;
    const guess = text.trim().slice(0, 40);
    if (!guess) return;
    const kind = actorKind(room, user.id);
    // Goed in elke taal van dit spel, dus ook "First Nephi" bij "1 Nephi".
    const group = state.items[state.index].data.groups.findIndex(
      (g, i) =>
        !state.found[i] &&
        answerMatches(guess, [g.answer, ...g.accept, ...[...room.dictionaries.values()].flatMap((d) => d.accept.get(g.answer) ?? [])])
    );
    if (kind === "team") {
      if (group >= 0) puzzleFound(room, group);
      else feedback(room, room.activeId, `"${guess}" is niet goed`, "bad");
    } else if (kind === "silent") {
      const guesses = state.guesses.get(user.id) ?? [];
      if (guesses.length >= PUZZLE_SILENT_GUESSES) return;
      state.guesses.set(user.id, [...guesses, guess]);
      if (group >= 0) {
        const picks = state.picks.get(user.id) ?? new Set<number>();
        picks.add(group);
        state.picks.set(user.id, picks);
      }
    }
    broadcast(room);
  });

  const gridRoundFor = (room: Room): { round: GridRound; count: number } | null => {
    if (room.phase === "OPEN_DEUR" && room.openDeur && !room.openDeur.choosing && room.openDeur.index >= 0)
      return { round: room.openDeur, count: OPEN_DEUR_ANSWERS };
    if (room.phase === "MEMORY" && room.memory && !room.memory.reading) return { round: room.memory, count: MEMORY_ANSWERS };
    if (room.phase === "FINALE" && room.finale && room.finale.index >= 0) return { round: room.finale, count: FINALE_ANSWERS };
    return null;
  };

  socket.on("ak:tap_grid", ({ text: tapped }: { text?: unknown }) => {
    const room = activeRoom();
    if (!room || typeof tapped !== "string") return;
    const text = canonicalText(dictionaryFor(room, user.id), tapped);
    const grid = gridRoundFor(room);
    if (!grid || grid.round.revealed) return;
    const { round, count } = grid;
    const item = round.items[round.index];
    if (!item.grid.includes(text)) return;
    let kind = actorKind(room, user.id);
    if (kind === null && item.tapOnly && leaderOfActive(room) === user.id) kind = "team";
    if (kind === "team") {
      const index = item.answers.slice(0, count).findIndex((a) => a.text === text);
      if (index >= 0) gridFound(room, round, index);
      else if (!round.wrong.has(text)) gridWrong(room, round, text);
    } else if (kind === "silent") {
      silentGridPick(room, round, user.id, text, count);
    }
    broadcast(room);
  });

  socket.on("ak:tap_gallery", ({ option: tapped }: { option?: unknown }) => {
    const room = activeRoom();
    if (!room || room.phase !== "GALLERY" || typeof tapped !== "string" || !room.gallery || room.gallery.revealed) return;
    const state = room.gallery;
    const entryIndex = state.turnEntries[state.turnPos];
    const entry = entryIndex === undefined ? null : state.items[state.index].entries[entryIndex];
    const option = canonicalText(dictionaryFor(room, user.id), tapped);
    if (!entry || !entry.options.includes(option)) return;
    const kind = actorKind(room, user.id);
    if (kind === "team") {
      galleryAnswer(room, option === entry.answer);
    } else if (kind === "silent") {
      const picks = state.picks.get(user.id) ?? new Map<number, string>();
      picks.set(entryIndex, option);
      state.picks.set(user.id, picks);
    }
    broadcast(room);
  });

  socket.on("ak:choose_door", ({ index }: { index?: unknown }) => {
    const room = activeRoom();
    if (!room || room.phase !== "OPEN_DEUR" || typeof index !== "number") return;
    if (!(isQuizmaster(room) || leaderOfActive(room) === user.id)) return;
    chooseDoor(room, index);
    broadcast(room);
  });

  // Het apparaat dat voorleest (quizmaster, of zonder quizmaster wie aan de
  // beurt is) meldt dat het vers is uitgesproken: nu pas start de bedenktijd.
  socket.on("ak:listen_done", ({ number }: { number?: unknown }) => {
    const room = activeRoom();
    const state = room?.r369;
    if (!room || !state || room.phase !== "R369" || !state.listening || number !== state.index + 1) return;
    const speaker = room.quizmasterId ?? leaderOfActive(room);
    if (speaker !== user.id) return;
    startThinking369(room);
    broadcast(room);
  });

  socket.on("ak:qm_369", ({ correct }: { correct?: unknown }) => {
    const room = activeRoom();
    if (!room || !isQuizmaster(room) || room.phase !== "R369" || typeof correct !== "boolean") return;
    answer369(room, correct);
    broadcast(room);
  });

  socket.on("ak:qm_puzzle", ({ group }: { group?: unknown }) => {
    const room = activeRoom();
    if (!room || !isQuizmaster(room) || room.phase !== "PUZZLE" || typeof group !== "number") return;
    puzzleFound(room, group);
    broadcast(room);
  });

  socket.on("ak:qm_answer", ({ index }: { index?: unknown }) => {
    const room = activeRoom();
    if (!room || !isQuizmaster(room) || typeof index !== "number") return;
    const grid = gridRoundFor(room);
    if (!grid || index < 0 || index >= grid.count) return;
    gridFound(room, grid.round, index);
    broadcast(room);
  });

  socket.on("ak:qm_gallery", ({ correct }: { correct?: unknown }) => {
    const room = activeRoom();
    if (!room || !isQuizmaster(room) || room.phase !== "GALLERY" || typeof correct !== "boolean") return;
    galleryAnswer(room, correct);
    broadcast(room);
  });
}
