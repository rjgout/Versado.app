import type { AlleskennerItemKind, AlleskennerSoloMode } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dayKey, weekStartKey } from "@/lib/dates";
import { getAcceptedFriendIds } from "@/lib/presence";
import { completeAlleskennerSolo } from "@/lib/streak";
import type { AlleskennerDataFor } from "@/lib/alleskenner/content";
import {
  alleskennerLanguageFor,
  alleskennerLanguages,
  ensureAlleskennerContent,
  interleave,
  markSeen,
  pickItems,
} from "@/lib/alleskenner/pool";
import { DEFAULT_LANGUAGE } from "@/lib/languages";

// De Slimste Heilige alleen spelen (zie docs/ALLESKENNER.md, "Alleen spelen"). Het
// spel zelf draait in dezelfde spelserver als een quizavond
// (src/server/alleskenner.ts, een kamer met één deelnemer); hier staat wat
// eromheen hoort: onderdelen kiezen, het resultaat vastleggen en de
// klassementen. Valt via de spelserver onder de eager-importketen van
// server.ts: geen request-scoped Next-API's importeren.

export const SOLO_QUESTIONS = 9;
export const SOLO_DOORS = 3;
const LEADERBOARD_SIZE = 10;

export interface SoloItems {
  questions: string[]; // in speelvolgorde
  doors: string[];
  puzzles: string[];
  galleries: string[];
  memories: string[];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * XP naar verhouding van de eindstand. Van de dag levert meer op dan oefenen,
 * omdat je hem maar één keer per dag speelt; oefenen blijft bewust beperkt
 * (een potje duurt een paar minuten, dus eindeloos herhalen loont niet).
 */
export function soloXp(mode: AlleskennerSoloMode, seconds: number): number {
  const s = Math.max(0, Math.round(seconds));
  return mode === "DAILY" ? 20 + Math.min(40, Math.floor(s / 5)) : 5 + Math.min(15, Math.floor(s / 10));
}

// --- Onderdelen kiezen ------------------------------------------------------------

/**
 * Voor De Slimste Heilige van de dag telt niet wat één speler al zag, maar wat al
 * eerder van de dag was: dat komt pas terug als al het andere op is.
 */
async function pickForDay<K extends AlleskennerItemKind>(
  kind: K,
  count: number,
  used: Set<string>,
  accept: (data: AlleskennerDataFor<K>) => boolean = () => true
): Promise<string[]> {
  if (count <= 0) return [];
  const rows = await prisma.alleskennerItem.findMany({ where: { kind, enabled: true }, select: { id: true, data: true } });
  const ids = shuffle(rows.filter((r) => accept(JSON.parse(r.data) as AlleskennerDataFor<K>)).map((r) => ({ id: r.id })));
  const fresh = ids.filter((r) => !used.has(r.id));
  const old = ids.filter((r) => used.has(r.id));
  // De voorkeur voor nieuwe inhoud blijft behouden, maar de spelvolgorde
  // mag niet de vaste volgorde van de generatorgroepen volgen.
  return shuffle([...interleave(fresh), ...old].slice(0, count)).map((r) => r.id);
}

async function chooseDailyItems(): Promise<SoloItems> {
  const earlier = await prisma.alleskennerDailySet.findMany({ select: { items: true } });
  const used = new Set(earlier.flatMap((row) => Object.values(JSON.parse(row.items) as SoloItems).flat()));
  // Geen luistervraag: die vraagt geluid en laat de bedenktijd pas starten
  // als het voorlezen klaar is, en dat is in een klassement niet eerlijk te
  // controleren.
  const questions = await pickForDay("QUESTION", SOLO_QUESTIONS, used, (d) => !d.listen);
  return {
    questions: shuffle(questions),
    doors: await pickForDay("TOPIC", SOLO_DOORS, used, (d) => d.answers.length >= 4),
    puzzles: await pickForDay("PUZZLE", 1, used),
    galleries: await pickForDay("GALLERY", 1, used),
    memories: await pickForDay("MEMORY", 1, used),
  };
}

// Oefenen: alleen onderdelen die in de taal van de speler bestaan. De
// De Slimste Heilige van de dag is voor iedereen dezelfde rij; daar valt een speler
// in een andere taal bij een onvertaald onderdeel terug op het Nederlands.
async function choosePracticeItems(userId: string): Promise<SoloItems> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { contentLanguage: true } });
  const language = alleskennerLanguageFor(user?.contentLanguage, await alleskennerLanguages());
  const languages = language === DEFAULT_LANGUAGE ? [] : [language];
  const listen = await pickItems("QUESTION", 1, [userId], (d) => Boolean(d.listen), languages);
  const normal = await pickItems("QUESTION", SOLO_QUESTIONS - listen.length, [userId], (d) => !d.listen, languages);
  const questions = shuffle(normal.map((q) => q.id));
  // De luistervraag nooit als eerste, net als bij een quizavond.
  if (listen[0]) questions.splice(1 + Math.floor(Math.random() * Math.max(1, questions.length - 1)), 0, listen[0].id);
  const ids = async <K extends AlleskennerItemKind>(kind: K, count: number, accept?: (d: AlleskennerDataFor<K>) => boolean) =>
    (await pickItems(kind, count, [userId], accept, languages)).map((i) => i.id);
  return {
    questions,
    doors: await ids("TOPIC", SOLO_DOORS, (d) => d.answers.length >= 4),
    puzzles: await ids("PUZZLE", 1),
    galleries: await ids("GALLERY", 1),
    memories: await ids("MEMORY", 1),
  };
}

/** Legt de onderdelen van vandaag vast; wie het eerst speelt, bepaalt ze voor iedereen. */
async function dailyItems(day: string): Promise<SoloItems> {
  const existing = await prisma.alleskennerDailySet.findUnique({ where: { dayKey: day } });
  if (existing) return JSON.parse(existing.items) as SoloItems;
  const chosen = await chooseDailyItems();
  // Geen upsert: die is in Prisma niet atomisch, dus twee spelers die
  // tegelijk als eerste beginnen botsen dan op de unieke sleutel. Invoegen
  // zonder fout bij een conflict, en daarna lezen wat er echt staat.
  await prisma.alleskennerDailySet.createMany({ data: [{ dayKey: day, items: JSON.stringify(chosen) }], skipDuplicates: true });
  const locked = await prisma.alleskennerDailySet.findUniqueOrThrow({ where: { dayKey: day } });
  return JSON.parse(locked.items) as SoloItems;
}

/**
 * Nieuw potje. Van de dag: één poging, ook als je halverwege stopt; een potje
 * dat nog loopt (bv. na het sluiten van de app) kun je hervatten.
 */
export async function startSoloRun(userId: string, mode: AlleskennerSoloMode): Promise<{ runId: string } | { error: string }> {
  await ensureAlleskennerContent();
  const today = dayKey();

  if (mode === "DAILY") {
    const existing = await prisma.alleskennerSoloRun.findUnique({ where: { userId_dayKey: { userId, dayKey: today } } });
    if (existing) {
      if (existing.status === "IN_PROGRESS") return { runId: existing.id };
      return { error: "Je hebt De Slimste Heilige van vandaag al gespeeld. Morgen staat er een nieuwe klaar." };
    }
  }

  const items = mode === "DAILY" ? await dailyItems(today) : await choosePracticeItems(userId);
  if (items.questions.length < 3) return { error: "Er zijn nog te weinig vragen om te spelen." };

  let runId: string;
  if (mode === "DAILY") {
    // Twee tikken tegelijk: de unieke index laat er één door, de ander krijgt die.
    await prisma.alleskennerSoloRun.createMany({
      data: [{ userId, mode, dayKey: today, items: JSON.stringify(items) }],
      skipDuplicates: true,
    });
    const run = await prisma.alleskennerSoloRun.findUniqueOrThrow({ where: { userId_dayKey: { userId, dayKey: today } } });
    if (run.status !== "IN_PROGRESS") return { error: "Je hebt De Slimste Heilige van vandaag al gespeeld." };
    runId = run.id;
  } else {
    // Een eerder oefenpotje dat nog open stond, telt niet meer.
    await prisma.alleskennerSoloRun.updateMany({
      where: { userId, mode: "PRACTICE", status: "IN_PROGRESS" },
      data: { status: "ABANDONED", finishedAt: new Date() },
    });
    runId = (await prisma.alleskennerSoloRun.create({ data: { userId, mode, items: JSON.stringify(items) } })).id;
  }

  // Ook wat je alleen speelt, komt op een quizavond niet meteen terug.
  await markSeen(Object.values(items).flat(), [userId]);
  return { runId };
}

// --- Afronden -------------------------------------------------------------------

export interface SoloResult {
  xpEarned: number;
  rank: number | null; // alleen van de dag
}

/**
 * Aangeroepen door de spelserver aan het eind van een potje. Voorwaardelijk
 * bijwerken, zodat een potje nooit twee keer XP oplevert. Zelf gestopt telt
 * niet mee en levert niets op.
 */
export async function recordSoloRun(runId: string, userId: string, seconds: number, finished: boolean): Promise<SoloResult | null> {
  const rounded = Math.max(0, Math.round(seconds));
  const saved = await prisma.alleskennerSoloRun.updateMany({
    where: { id: runId, userId, status: "IN_PROGRESS" },
    data: { status: finished ? "FINISHED" : "ABANDONED", seconds: rounded, finishedAt: new Date() },
  });
  if (saved.count === 0 || !finished) return null;

  const run = await prisma.alleskennerSoloRun.findUniqueOrThrow({ where: { id: runId } });
  const xpEarned = soloXp(run.mode, rounded);
  await completeAlleskennerSolo(userId, xpEarned, { mode: run.mode, seconds: rounded }, `solo:${runId}`);
  await prisma.alleskennerSoloRun.update({ where: { id: runId }, data: { xpEarned } });

  let rank: number | null = null;
  if (run.mode === "DAILY" && run.dayKey) {
    const better = await prisma.alleskennerSoloRun.count({
      where: {
        mode: "DAILY",
        dayKey: run.dayKey,
        status: "FINISHED",
        OR: [{ seconds: { gt: rounded } }, { seconds: rounded, finishedAt: { lt: run.finishedAt! } }],
      },
    });
    rank = better + 1;
  }
  return { xpEarned, rank };
}

// --- Overzicht en klassementen ----------------------------------------------------------

export interface SoloLeaderboardEntry {
  rank: number;
  userId: string;
  handle: string;
  discriminator: string;
  seconds: number;
  days?: number; // weekklassement: aantal gespeelde dagen
}

export interface SoloOverview {
  dayKey: string;
  today: {
    status: "NONE" | "IN_PROGRESS" | "FINISHED" | "ABANDONED";
    runId: string | null;
    seconds: number;
    xpEarned: number;
    rank: number | null;
  };
  practiceRunId: string | null;
  playersToday: number;
  leaderboards: {
    today: SoloLeaderboardEntry[];
    week: SoloLeaderboardEntry[];
    friends: SoloLeaderboardEntry[];
  };
}

async function withUsers<T extends { userId: string }>(rows: T[]) {
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: { id: true, handle: true, discriminator: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.flatMap((row) => {
    const user = byId.get(row.userId);
    return user ? [{ ...row, handle: user.handle, discriminator: user.discriminator }] : [];
  });
}

/** Top 10, plus jezelf eronder als je daar buiten valt. */
function topWithMe(entries: SoloLeaderboardEntry[], userId: string): SoloLeaderboardEntry[] {
  const top = entries.slice(0, LEADERBOARD_SIZE);
  const me = entries.find((e) => e.userId === userId);
  return me && !top.includes(me) ? [...top, me] : top;
}

export async function getSoloOverview(userId: string): Promise<SoloOverview> {
  const today = dayKey();
  const [mine, practice, todayRuns, weekGroups, friendIds] = await Promise.all([
    prisma.alleskennerSoloRun.findUnique({ where: { userId_dayKey: { userId, dayKey: today } } }),
    prisma.alleskennerSoloRun.findFirst({
      where: { userId, mode: "PRACTICE", status: "IN_PROGRESS" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    prisma.alleskennerSoloRun.findMany({
      where: { mode: "DAILY", dayKey: today, status: "FINISHED" },
      orderBy: [{ seconds: "desc" }, { finishedAt: "asc" }],
      select: { userId: true, seconds: true },
    }),
    prisma.alleskennerSoloRun.groupBy({
      by: ["userId"],
      where: { mode: "DAILY", status: "FINISHED", dayKey: { gte: weekStartKey(), lte: today } },
      _sum: { seconds: true },
      _count: { _all: true },
    }),
    getAcceptedFriendIds(userId),
  ]);

  const todayEntries = (await withUsers(todayRuns)).map((r, i) => ({ ...r, rank: i + 1 }));
  const weekSorted = weekGroups
    .map((g) => ({ userId: g.userId, seconds: g._sum.seconds ?? 0, days: g._count._all }))
    .sort((a, b) => b.seconds - a.seconds);
  const weekEntries = (await withUsers(weekSorted)).map((r, i) => ({ ...r, rank: i + 1 }));
  const circle = new Set([userId, ...friendIds]);
  const friendEntries = todayEntries.filter((e) => circle.has(e.userId)).map((e, i) => ({ ...e, rank: i + 1 }));

  const myRank = todayEntries.find((e) => e.userId === userId)?.rank ?? null;
  return {
    dayKey: today,
    today: {
      status: mine ? mine.status : "NONE",
      runId: mine?.status === "IN_PROGRESS" ? mine.id : null,
      seconds: mine?.seconds ?? 0,
      xpEarned: mine?.xpEarned ?? 0,
      rank: mine?.status === "FINISHED" ? myRank : null,
    },
    practiceRunId: practice?.id ?? null,
    playersToday: todayEntries.length,
    leaderboards: {
      today: topWithMe(todayEntries, userId),
      week: topWithMe(weekEntries, userId),
      friends: friendEntries,
    },
  };
}
