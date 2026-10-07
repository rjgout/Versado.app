/**
 * De Duo-ranking van Samen spelen, puur en zonder database.
 *
 * Productregel: de Duo-score is de hoogste individuele score van de laatste twee
 * spelers op het moment dat de gezamenlijke run definitief eindigt:
 * `duoScore = max(scoreA, scoreB)`. Geen som, geen gemiddelde en geen bonussen
 * (deelnemers, plaatsing, Genezen, XP, duur of moeilijkheid). De run stopt al
 * zodra er nog één speler over is, dus na het uiteenvallen van het duo kan
 * geen van beiden de score nog verhogen (zie settleMatch in match.ts).
 *
 * De ranking toont het duo als één gezamenlijke entry: niet "A won", maar "A + B".
 */

export interface DuoResultRow {
  matchId: string;
  userAId: string;
  userBId: string;
  scoreA: number;
  scoreB: number;
  finishedAt: Date;
}

export function duoScore(scoreA: number, scoreB: number): number {
  return Math.max(scoreA, scoreB);
}

/**
 * Canonieke duo-identiteit: de twee gebruikers-id's gesorteerd. A+B en B+A zijn
 * dezelfde sleutel; A+B en A+C verschillende.
 */
export function duoKey(userIdOne: string, userIdTwo: string): string {
  return userIdOne < userIdTwo ? `${userIdOne}+${userIdTwo}` : `${userIdTwo}+${userIdOne}`;
}

export interface RankedDuo {
  key: string;
  userAId: string;
  userBId: string;
  score: number;
  /** Wanneer het duo dit beste resultaat behaalde (bepaalt de tie-break). */
  finishedAt: Date;
  matchId: string;
}

/**
 * Per duo telt alleen het beste resultaat; een slechtere run verlaagt het nooit.
 * Volgorde: hoogste Duo-score, bij gelijke score het duo dat die score het eerst
 * behaalde (zoals de solo-ranking: een later gelijk resultaat verdringt niemand),
 * daarna de duo-sleutel als vaste laatste tie-breaker.
 */
export function rankDuos(rows: DuoResultRow[]): RankedDuo[] {
  const best = new Map<string, RankedDuo>();
  for (const row of rows) {
    const key = duoKey(row.userAId, row.userBId);
    const candidate: RankedDuo = {
      key,
      userAId: row.userAId < row.userBId ? row.userAId : row.userBId,
      userBId: row.userAId < row.userBId ? row.userBId : row.userAId,
      score: duoScore(row.scoreA, row.scoreB),
      finishedAt: row.finishedAt,
      matchId: row.matchId,
    };
    const old = best.get(key);
    const better =
      !old ||
      candidate.score > old.score ||
      (candidate.score === old.score && (candidate.finishedAt < old.finishedAt || (candidate.finishedAt.getTime() === old.finishedAt.getTime() && candidate.matchId < old.matchId)));
    if (better) best.set(key, candidate);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.finishedAt.getTime() - b.finishedAt.getTime() || a.key.localeCompare(b.key));
}
