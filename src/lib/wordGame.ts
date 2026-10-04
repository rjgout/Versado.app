import bomWords from "../../prisma/bomWords.json";
import { addDays } from "@/lib/dates";
import { DEFAULT_TIME_ZONE, dayKeyInZone, resolveTimeZone, zonedParts, zonedTimeToUtc } from "@/lib/timeZone";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { completeWordGame } from "@/lib/streak";
import { awardXp } from "@/lib/xp";
import { awardCompetitionXp } from "@/lib/competitionXp";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { findVersesContainingWord, type VerseMatch } from "@/lib/dictionary";

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;

// Alleen woorden uit het Boek van Mormon (zelfde bron als het Woordspel,
// zie src/lib/scrabble/dictionary.ts) van precies 5 letters — zowel de
// antwoorden als de toegestane gok-woorden komen uit deze lijst.
const WORDS: readonly string[] = (bomWords as string[]).filter((w) => w.length === WORD_LENGTH);

export function isValidGuess(word: string): boolean {
  return WORDS.includes(word.toLowerCase());
}

// Het woord wisselt om 18:00 in de tijdzone van de speler (zie
// docs/TIJD.md), niet om middernacht: vóór 18:00 hoort een moment nog bij de
// woorddag ervoor. De woorddag (dayKey) kiest het woord, dus iedereen loopt
// dezelfde reeks woorden door; de tijdzone bepaalt alleen wanneer het
// volgende woord beschikbaar komt. Altijd met de servertijd: een verzette
// toestelklok ontsluit geen woorden.
export const RELEASE_HOUR = 18;

export interface WordGamePeriod {
  /** De woorddag; begint om 18:00 lokaal op die kalenderdag. */
  dayKey: string;
  /** Absoluut moment waarop dit woord voor de speler beschikbaar kwam. */
  releasedAt: Date;
  /** Absoluut moment waarop het volgende woord beschikbaar komt. */
  nextReleaseAt: Date;
  /** Lokale kalenderrelatie van het volgende woord, bepaald met de servertijd. */
  nextReleaseDay: "today" | "tomorrow";
}

export function wordGamePeriod(date: Date, timeZone: string): WordGamePeriod {
  const zone = resolveTimeZone(timeZone);
  const localDay = dayKeyInZone(date, zone);
  const beforeRelease = zonedParts(date, zone).hour < RELEASE_HOUR;
  const dayKey = beforeRelease ? addDays(localDay, -1) : localDay;
  return {
    dayKey,
    releasedAt: zonedTimeToUtc(dayKey, RELEASE_HOUR, 0, zone),
    nextReleaseAt: zonedTimeToUtc(addDays(dayKey, 1), RELEASE_HOUR, 0, zone),
    nextReleaseDay: beforeRelease ? "today" : "tomorrow",
  };
}

/** Standaard Nederlandse tijd: het gedrag van vóór de tijdzones (accounts zonder bekende tijdzone). */
export function wordGameDayKey(date: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE): string {
  return wordGamePeriod(date, timeZone).dayKey;
}

const EPOCH_MS = Date.UTC(2024, 0, 1, 12); // willekeurig, vast referentiepunt

function daysSinceEpoch(gameDayKey: string): number {
  const ms = new Date(`${gameDayKey}T12:00:00Z`).getTime();
  return Math.round((ms - EPOCH_MS) / (24 * 60 * 60 * 1000));
}

// Kleine, deterministische PRNG (mulberry32) — géén Math.random, want het
// woord van vandaag moet voor iedereen (en bij elke aanroep) hetzelfde zijn.
function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr];
  const rand = mulberry32(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Doorloopt alle woorden in een (per cyclus opnieuw geschudde) willekeurige
// volgorde vóór er ooit een woord herhaald wordt — puur een functie van de
// datum, dus geen aparte databasetabel met "het woord van vandaag" nodig
// (en dus ook geen achtergrondtaak die dat elke dag zou moeten bijwerken).
export function getWordForDay(gameDayKey: string): string {
  const n = WORDS.length;
  const index = daysSinceEpoch(gameDayKey);
  const cycle = Math.floor(index / n);
  const position = ((index % n) + n) % n;
  const order = seededShuffle(WORDS, cycle);
  return order[position];
}

export type LetterState = "correct" | "present" | "absent";

/** Klassieke woordraad-feedback: eerst exacte plekken, dan (uit wat overblijft) verkeerd-geplaatste letters. */
export function evaluateGuess(guess: string, target: string): LetterState[] {
  const g = guess.toLowerCase().split("");
  const t = target.toLowerCase().split("");
  const result: LetterState[] = new Array(WORD_LENGTH).fill("absent");
  const consumed = new Array(WORD_LENGTH).fill(false);

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (g[i] === t[i]) {
      result[i] = "correct";
      consumed[i] = true;
    }
  }
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === "correct") continue;
    const j = t.findIndex((ch, idx) => ch === g[i] && !consumed[idx]);
    if (j !== -1) {
      result[i] = "present";
      consumed[j] = true;
    }
  }
  return result;
}

// Zie de spelregel: goed bij de laatste (6e) poging = 25 XP, en elke poging
// eerder levert 5 XP extra op (dus 1e poging = 50 XP).
export function xpForWin(guessesUsed: number): number {
  return 25 + 5 * (MAX_GUESSES - guessesUsed);
}

const LEADERBOARD_XP_BONUSES: Record<number, number> = {
  1: 50,
  2: 40,
  3: 35,
  4: 30,
  5: 25,
  6: 20,
  7: 15,
  8: 10,
  9: 10,
  10: 10,
};

function leaderboardXpBonusForRank(rank: number): number {
  return LEADERBOARD_XP_BONUSES[rank] ?? 0;
}

export interface WordGameLeaderboardEntry {
  rank: number;
  userId: string;
  handle: string;
  discriminator: string;
  finishedAt: string;
  /** Hoeveel minuten na de eigen 18:00 het woord geraden werd (de rangorde). */
  minutesAfterRelease: number;
}

// Het klassement rangschikt op tijd ná de eigen 18:00, niet op het absolute
// tijdstip: anders zouden spelers in Azië elke dag bovenaan staan, omdat hun
// woord uren eerder beschikbaar komt. Potjes van vóór de tijdzones hebben
// geen releasedAt; die kwamen allemaal om 18:00 Nederlandse tijd vrij, dus
// hun volgorde blijft gelijk aan vroeger.
function releaseOf(game: { dayKey: string; releasedAt: Date | null }): Date {
  return game.releasedAt ?? zonedTimeToUtc(game.dayKey, RELEASE_HOUR, 0, DEFAULT_TIME_ZONE);
}

function solveMs(game: { dayKey: string; releasedAt: Date | null; finishedAt: Date | null }): number {
  return game.finishedAt!.getTime() - releaseOf(game).getTime();
}

async function rankedWinners(dayKey: string, db: Prisma.TransactionClient = prisma) {
  const games = await db.wordGame.findMany({
    where: { dayKey, status: "WON", finishedAt: { not: null } },
    select: {
      id: true,
      dayKey: true,
      releasedAt: true,
      finishedAt: true,
      userId: true,
      user: { select: { id: true, handle: true, discriminator: true } },
    },
  });
  return games.sort((a, b) => solveMs(a) - solveMs(b) || a.finishedAt!.getTime() - b.finishedAt!.getTime());
}

export interface WordGameView {
  dayKey: string;
  /** Wanneer het volgende woord beschikbaar komt (absoluut), en de servertijd: de client ververst daarop zonder eigen tijdzonerekensom. */
  nextReleaseAt: string;
  nextReleaseDay: "today" | "tomorrow";
  /** Wanneer de wereldwijde rang definitief is en de rangbonus kan worden uitgedeeld. */
  bonusSettlesAt: string;
  serverNow: number;
  wordLength: number;
  maxGuesses: number;
  guesses: { word: string; result: LetterState[] }[];
  status: "IN_PROGRESS" | "WON" | "LOST";
  xpEarned: number;
  // Alleen gezet zodra het potje van vandaag is afgerond — geheim tot dan.
  word: string | null;
  // Idem: pas gevuld na afloop (winst of verlies maakt niet uit), zodat je
  // de verzen met het woord van vandaag kan naslaan.
  verses: VerseMatch[];
  leaderboard: WordGameLeaderboardEntry[];
  /** Is de rangbonus van deze woorddag al uitgedeeld? Tot dan is de stand voorlopig. */
  settled: boolean;
  /** Eigen plek in de (voorlopige) stand, als je het woord geraden hebt. */
  provisionalRank: number | null;
  /** Definitieve rang en bonus van deze woorddag (pas na afloop gezet). */
  leaderboardRank: number | null;
  leaderboardXpBonus: number;
  /** Uitslag van de vorige woorddag, als je daar in de top 10 eindigde. */
  previousResult: { dayKey: string; rank: number; xp: number } | null;
}

function toLeaderboard(games: Awaited<ReturnType<typeof rankedWinners>>): WordGameLeaderboardEntry[] {
  return games.slice(0, 10).map((game, index) => ({
    rank: index + 1,
    userId: game.user.id,
    handle: game.user.handle,
    discriminator: game.user.discriminator,
    finishedAt: game.finishedAt!.toISOString(),
    minutesAfterRelease: Math.max(0, Math.floor(solveMs(game) / 60_000)),
  }));
}

// --- Rangbonus: pas na afloop van de woorddag ------------------------------
//
// Een woorddag begint om 18:00 lokaal en duurt tot 18:00 de volgende dag. De
// laatste tijdzone ter wereld is UTC-12: daar eindigt woorddag D pas om
// 18:00 op D+1 lokaal, oftewel D+2 06:00 UTC. Daarna kan niemand meer voor D
// raden, dus is de rangorde definitief en wordt de bonus uitgedeeld.
const LAST_TIME_ZONE = "Etc/GMT+12";

/** Vanaf wanneer woorddag D overal voorbij is en de rangbonus vastligt. */
export function wordDayClosesAt(dayKey: string): Date {
  return zonedTimeToUtc(addDays(dayKey, 1), RELEASE_HOUR, 0, LAST_TIME_ZONE);
}

export interface SettledBonus {
  userId: string;
  dayKey: string;
  rank: number;
  xp: number;
}

/**
 * Deelt de rangbonus uit voor elke woorddag die overal voorbij is en nog
 * niet is afgehandeld (DailyWord.bonusSettledAt). Precies één keer per
 * woorddag: de claim (updateMany op bonusSettledAt = null) en de uitbetaling
 * zitten in één transactie. Wordt elke minuut door de scheduler aangeroepen;
 * geeft de uitbetalingen terug zodat de aanroeper meldingen kan sturen.
 */
export async function settleWordGameBonuses(now: Date = new Date()): Promise<SettledBonus[]> {
  const open = await prisma.dailyWord.findMany({ where: { bonusSettledAt: null }, select: { dayKey: true } });
  const due = open.map((d) => d.dayKey).filter((dayKey) => wordDayClosesAt(dayKey).getTime() <= now.getTime()).sort();
  const settled: SettledBonus[] = [];
  for (const dayKey of due) {
    const paid = await prisma.$transaction(async (tx) => {
      const claim = await tx.dailyWord.updateMany({ where: { dayKey, bonusSettledAt: null }, data: { bonusSettledAt: now } });
      if (claim.count === 0) return [];
      const winners = (await rankedWinners(dayKey, tx)).slice(0, 10);
      const out: SettledBonus[] = [];
      for (const [index, game] of winners.entries()) {
        const rank = index + 1;
        const xp = leaderboardXpBonusForRank(rank);
        await tx.wordGame.update({
          where: { id: game.id },
          data: { leaderboardRank: rank, leaderboardXpBonus: xp, xpEarned: { increment: xp } },
        });
        if (xp > 0) {
          await awardXp(tx, game.userId, xp, "WORD_GAME_WON", { leaderboardBonus: xp, rank, dayKey });
          await awardCompetitionXp(tx, game.userId, "WORD_GAME", xp, { metadata: { leaderboardBonus: xp, rank, dayKey } });
          await checkAndAwardAchievements(tx, game.userId);
        }
        out.push({ userId: game.userId, dayKey, rank, xp });
      }
      return out;
    });
    settled.push(...paid);
  }
  return settled;
}

async function buildView(period: WordGamePeriod, now: Date, game: {
  userId: string;
  dayKey: string;
  word: string;
  guesses: string;
  status: string;
  xpEarned: number;
  leaderboardRank: number | null;
  leaderboardXpBonus: number;
}): Promise<WordGameView> {
  const guesses = (JSON.parse(game.guesses) as string[]).map((word) => ({
    word,
    result: evaluateGuess(word, game.word),
  }));
  const finished = game.status !== "IN_PROGRESS";
  const previousDay = addDays(game.dayKey, -1);
  const [ranked, daily, previous] = await Promise.all([
    rankedWinners(game.dayKey),
    prisma.dailyWord.findUnique({ where: { dayKey: game.dayKey }, select: { bonusSettledAt: true } }),
    prisma.wordGame.findUnique({
      where: { userId_dayKey: { userId: game.userId, dayKey: previousDay } },
      select: { leaderboardRank: true, leaderboardXpBonus: true },
    }),
  ]);
  const ownIndex = ranked.findIndex((g) => g.userId === game.userId);
  return {
    dayKey: game.dayKey,
    nextReleaseAt: period.nextReleaseAt.toISOString(),
    nextReleaseDay: period.nextReleaseDay,
    bonusSettlesAt: wordDayClosesAt(game.dayKey).toISOString(),
    serverNow: now.getTime(),
    wordLength: WORD_LENGTH,
    maxGuesses: MAX_GUESSES,
    guesses,
    status: game.status as WordGameView["status"],
    xpEarned: game.xpEarned,
    word: finished ? game.word : null,
    verses: finished ? await findVersesContainingWord(game.word) : [],
    leaderboard: toLeaderboard(ranked),
    settled: !!daily?.bonusSettledAt,
    provisionalRank: ownIndex === -1 ? null : ownIndex + 1,
    leaderboardRank: game.leaderboardRank,
    leaderboardXpBonus: game.leaderboardXpBonus,
    previousResult:
      previous?.leaderboardRank && previous.leaderboardXpBonus > 0
        ? { dayKey: previousDay, rank: previous.leaderboardRank, xp: previous.leaderboardXpBonus }
        : null,
  };
}

/**
 * Legt het woord voor een dayKey definitief vast — atomisch, dus de eerste
 * speler van die dag "wint" en iedereen daarna (ongeacht eventuele
 * codewijzigingen tussendoor) krijgt exact datzelfde woord terug. Zie de
 * toelichting bij het DailyWord-model in schema.prisma.
 */
async function getOrLockWordForDay(dayKey: string): Promise<string> {
  const daily = await prisma.dailyWord.upsert({
    where: { dayKey },
    update: {},
    create: { dayKey, word: getWordForDay(dayKey) },
  });
  return daily.word;
}

/**
 * Haalt het potje van vandaag op, en maakt het aan als het nog niet bestaat
 * — dit dwingt meteen "één keer per dag" af via @@unique([userId, dayKey]).
 * timeZone is die van het account (User.timeZone, null = Nederlandse tijd);
 * now is altijd de servertijd, alleen tests geven een ander moment mee.
 */
export async function getOrCreateTodayGame(userId: string, timeZone: string | null, now: Date = new Date()): Promise<WordGameView> {
  const period = wordGamePeriod(now, resolveTimeZone(timeZone));
  const { dayKey } = period;
  const existing = await prisma.wordGame.findUnique({ where: { userId_dayKey: { userId, dayKey } } });
  if (existing) return await buildView(period, now, existing);

  const word = await getOrLockWordForDay(dayKey);
  const created = await prisma.wordGame.upsert({
    where: { userId_dayKey: { userId, dayKey } },
    update: {},
    // releasedAt: wanneer dit woord voor deze speler vrijkwam (voor het klassement).
    create: { userId, dayKey, word, releasedAt: period.releasedAt },
  });
  return await buildView(period, now, created);
}

export async function submitGuess(
  userId: string,
  rawGuess: string,
  timeZone: string | null,
  now: Date = new Date()
): Promise<(WordGameView & { newAchievements: string[] }) | { error: string }> {
  const guess = rawGuess.trim().toLowerCase();
  if (guess.length !== WORD_LENGTH) return { error: `Het woord moet ${WORD_LENGTH} letters hebben.` };
  if (!isValidGuess(guess)) return { error: "Dat woord ken ik niet uit het Boek van Mormon." };

  const period = wordGamePeriod(now, resolveTimeZone(timeZone));
  const { dayKey } = period;
  const game = await prisma.wordGame.findUnique({ where: { userId_dayKey: { userId, dayKey } } });
  if (!game) return { error: "Er is nog geen potje voor vandaag — begin eerst een nieuw spel." };
  if (game.status !== "IN_PROGRESS") return { error: "Je hebt het woord van vandaag al gespeeld." };

  const priorGuesses = JSON.parse(game.guesses) as string[];
  if (priorGuesses.length >= MAX_GUESSES) return { error: "Je hebt geen pogingen meer over." };

  const guesses = [...priorGuesses, guess];
  const won = guess === game.word;
  const outOfGuesses = guesses.length >= MAX_GUESSES;
  const finished = won || outOfGuesses;
  const xpEarned = won ? xpForWin(guesses.length) : 0;

  const finishedAt = finished ? now : undefined;

  // Alleen de XP voor het raden zelf. De rangbonus volgt pas als de woorddag
  // overal voorbij is (settleWordGameBonuses): een speler in een latere
  // tijdzone kan nog sneller zijn na zijn eigen 18:00.
  // Voorwaardelijk bijwerken: twee gelijktijdige gokken op hetzelfde spel
  // (dubbelklik, twee tabbladen) mogen niet allebei XP opleveren.
  const saved = await prisma.wordGame.updateMany({
    where: { id: game.id, status: "IN_PROGRESS", guesses: game.guesses },
    data: {
      guesses: JSON.stringify(guesses),
      status: finished ? (won ? "WON" : "LOST") : "IN_PROGRESS",
      xpEarned,
      finishedAt,
    },
  });
  if (saved.count === 0) return { error: "Je gok is al verwerkt. Ververs de pagina." };
  const updated = await prisma.wordGame.findUniqueOrThrow({ where: { id: game.id } });

  const newAchievements = finished ? (await completeWordGame(userId, xpEarned, `word:${game.id}`)).newAchievements : [];

  return { ...(await buildView(period, now, updated)), newAchievements };
}
