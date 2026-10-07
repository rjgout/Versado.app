/**
 * Welke rankings bestaan er: solo (Vandaag en All-time) en duo (alleen All-time).
 * Puur, zodat route en scherm dezelfde regel delen en tests hem direct kunnen
 * controleren. Een duo heeft geen gezamenlijke lokale dag (twee tijdzones), dus
 * "duo + vandaag" bestaat niet en wordt nooit stilletjes omgezet.
 */
export type LeaderboardKind = "solo" | "duo";
export type LeaderboardBoard = "today" | "all-time";

export function boardsFor(kind: LeaderboardKind): readonly LeaderboardBoard[] {
  return kind === "duo" ? ["all-time"] : ["today", "all-time"];
}

/** Het bord dat bij een soort ranking getoond wordt, gegeven de laatst gekozen solo-keuze. */
export function effectiveBoard(kind: LeaderboardKind, soloBoard: LeaderboardBoard): LeaderboardBoard {
  return kind === "duo" ? "all-time" : soloBoard;
}

export type LeaderboardQuery = { ok: true; kind: "solo"; board: LeaderboardBoard } | { ok: true; kind: "duo"; board: "all-time" } | { ok: false };

/**
 * Solo houdt de bestaande conventie: een onbekend of ontbrekend bord valt terug
 * op "today". Duo accepteert alleen All-time (of geen bord); elke andere waarde,
 * ook "today", is een ongeldige combinatie en geeft geen ranking.
 */
export function parseLeaderboardQuery(type: string | null, board: string | null): LeaderboardQuery {
  if (type === "duo") return board === null || board === "all-time" ? { ok: true, kind: "duo", board: "all-time" } : { ok: false };
  return { ok: true, kind: "solo", board: board === "all-time" ? "all-time" : "today" };
}
