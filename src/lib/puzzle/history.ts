import { prisma } from "@/lib/db";
import { requirePuzzleContent } from "@/lib/puzzle/access";

// Afgeronde gezamenlijke puzzels en wedstrijden van één gebruiker, de nieuwste eerst, met cursorpaginatie (keyset).
// De hub toont de laatste drie (met de bestaande 14-dagenregel voor wedstrijden); de aparte geschiedenisweergave
// pagineert door alles wat de gebruiker zelf mag zien. Er verandert niets aan de gegevens: dit leest alleen.
//
// Volgorde: afrondtijd aflopend, dan soort (wedstrijd voor samen) en dan id aflopend. Die drie samen zijn uniek, dus elke
// pagina sluit exact aan op de vorige, ook als twee puzzels in dezelfde milliseconde zijn afgerond of er tijdens het
// bladeren iets bij komt.

export const HUB_FINISHED_LIMIT = 3;
export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_MAX_PAGE_SIZE = 50;
/** Op de hub verdwijnen afgeronde wedstrijden na 14 dagen (bestaande afspraak); de geschiedenisweergave toont ze wel. */
export const HUB_MATCH_DAYS = 14;

export interface HistoryItem {
  /** Uniek en stabiel: `coop:<id>` of `match:<id>`. */
  key: string;
  kind: "COOP" | "MATCH";
  id: string;
  finishedAt: string;
  pieceCount: number;
  players: string[];
  matchKind?: "LIVE" | "ASYNC";
  /** Alleen wedstrijden: de officiële vraag staat nog open (regelversie 2, eigen finish, nog niet beantwoord). */
  questionOpen?: boolean;
}

const RANK = { COOP: 0, MATCH: 1 } as const;
export interface HistoryCursor { t: number; r: 0 | 1; id: string }

/** Nieuwste eerst: afrondtijd, dan soort, dan id (alles aflopend). */
export function compareHistory(a: { t: number; r: number; id: string }, b: { t: number; r: number; id: string }): number {
  return b.t - a.t || b.r - a.r || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export const cursorOf = (item: HistoryItem): HistoryCursor => ({ t: Date.parse(item.finishedAt), r: RANK[item.kind], id: item.id });

export function encodeCursor(cursor: HistoryCursor): string { return Buffer.from(JSON.stringify([cursor.t, cursor.r, cursor.id])).toString("base64url"); }

/** Een ongeldige of geknoeide cursor geeft null (de route antwoordt dan met een foutmelding, nooit met andermans gegevens). */
export function decodeCursor(raw: string | null | undefined): HistoryCursor | null {
  if (!raw || raw.length > 200) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(value) || value.length !== 3) return null;
    const [t, r, id] = value;
    if (typeof t !== "number" || !Number.isFinite(t) || (r !== 0 && r !== 1) || typeof id !== "string" || !id || id.length > 64) return null;
    return { t, r, id };
  } catch { return null; }
}

/** Voegt gesorteerde lijsten samen tot één pagina; `nextCursor` is gezet als er meer is. Puur (getest zonder database). */
export function pageOfHistory(items: readonly HistoryItem[], limit: number): { items: HistoryItem[]; nextCursor: string | null } {
  const sorted = [...items].sort((a, b) => compareHistory({ t: Date.parse(a.finishedAt), r: RANK[a.kind], id: a.id }, { t: Date.parse(b.finishedAt), r: RANK[b.kind], id: b.id }));
  const page = sorted.slice(0, limit);
  return { items: page, nextCursor: sorted.length > limit && page.length ? encodeCursor(cursorOf(page[page.length - 1])) : null };
}

/** Where-deel voor "alles na de cursor" voor een bron met de gegeven rang. */
function afterCursor(rank: 0 | 1, cursor: HistoryCursor, timeField: "completedAt" | "finishedAt", idField: "id") {
  const at = new Date(cursor.t);
  const sameTime = rank < cursor.r ? {} : rank === cursor.r ? { [idField]: { lt: cursor.id } } : null;
  return { OR: [{ [timeField]: { lt: at } }, ...(sameTime ? [{ [timeField]: at, ...sameTime }] : [])] };
}

export interface HistoryOptions {
  limit?: number;
  cursor?: HistoryCursor | null;
  /** Hub: alleen wedstrijden die na dit moment zijn afgerond (de 14-dagenregel). */
  matchesSince?: Date;
}

export async function listFinishedPuzzles(userId: string, options: HistoryOptions = {}): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
  await requirePuzzleContent();
  const limit = Math.max(1, Math.min(HISTORY_MAX_PAGE_SIZE, Math.floor(options.limit ?? HISTORY_PAGE_SIZE)));
  const { cursor, matchesSince } = options;
  // Elke bron levert maximaal limit + 1 rijen (genoeg om te weten of er meer is); nooit een onbegrensde lijst.
  const matchWhere = { status: "FINISHED" as const, finishedAt: { not: null, ...(matchesSince ? { gt: matchesSince } : {}) }, ...(cursor ? afterCursor(1, cursor, "finishedAt", "id") : {}) };
  const [sessions, matches] = await Promise.all([
    prisma.puzzleSession.findMany({
      where: { mode: "COOP", status: "COMPLETED", participants: { some: { userId } }, completedAt: { not: null }, ...(cursor ? afterCursor(0, cursor, "completedAt", "id") : {}) },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }], take: limit + 1,
      include: { variant: { select: { pieceCount: true } }, participants: { include: { user: { select: { handle: true } } } } },
    }),
    prisma.puzzleMatchParticipant.findMany({
      where: { userId, status: { not: "DECLINED" }, match: matchWhere },
      orderBy: [{ match: { finishedAt: "desc" } }, { matchId: "desc" }], take: limit + 1,
      include: { match: { select: { id: true, kind: true, finishedAt: true, resultRules: true, variant: { select: { pieceCount: true } }, participants: { include: { user: { select: { handle: true } } } } } } },
    }),
  ]);
  const items: HistoryItem[] = [
    ...sessions.map((row): HistoryItem => ({ key: `coop:${row.id}`, kind: "COOP", id: row.id, finishedAt: row.completedAt!.toISOString(), pieceCount: row.variant.pieceCount, players: row.participants.map((p) => p.user.handle) })),
    ...matches.map((row): HistoryItem => ({
      key: `match:${row.match.id}`, kind: "MATCH", id: row.match.id, finishedAt: row.match.finishedAt!.toISOString(), pieceCount: row.match.variant.pieceCount,
      players: row.match.participants.filter((p) => p.status !== "DECLINED").map((p) => p.user.handle), matchKind: row.match.kind,
      questionOpen: row.match.resultRules >= 2 && row.status === "FINISHED" && row.answeredAt === null,
    })),
  ];
  return pageOfHistory(items, limit);
}

/** De laatste drie voor de hub, met de 14-dagenregel voor wedstrijden. */
export function listRecentFinishedForHub(userId: string, now = new Date()) {
  return listFinishedPuzzles(userId, { limit: HUB_FINISHED_LIMIT, matchesSince: new Date(now.getTime() - HUB_MATCH_DAYS * 86_400_000) });
}

/** Is er in de hele geschiedenis (zonder 14-dagenregel) ten minste één afgeronde puzzel? Bepaalt of "Bekijk alle" zin heeft. */
export async function hasFinishedPuzzles(userId: string): Promise<boolean> {
  return (await listFinishedPuzzles(userId, { limit: 1 })).items.length > 0;
}
