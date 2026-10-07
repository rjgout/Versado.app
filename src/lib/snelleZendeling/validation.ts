import { PAIR_SPACING, worldSpeed } from "./gameplay";

export const MAX_RUN_SCORE = 10_000;

// Tijd die een run minimaal nodig heeft om score n te halen. Tussen het
// passeren van paar k en paar k+1 vliegt de wereld met de snelheid die bij
// score k hoort (difficulty.ts), dus daar zit precies PAIR_SPACING / snelheid
// tussen. Het eerste punt is gratis (de afstand tot het eerste paar hangt van
// de start af). De tabel gebruikt dezelfde curve als de client, zodat een
// snellere wereld geen echte score als te snel afwijst.
const MIN_SECONDS_TO_REACH: Float64Array = (() => {
  const table = new Float64Array(MAX_RUN_SCORE + 1);
  for (let score = 2; score <= MAX_RUN_SCORE; score++) table[score] = table[score - 1] + PAIR_SPACING / worldSpeed(score - 1);
  return table;
})();

/** Minimale looptijd in seconden om `score` te kunnen halen. */
export function minSecondsToReachScore(score: number): number {
  const clamped = Math.max(0, Math.min(MAX_RUN_SCORE, Math.floor(score)));
  return MIN_SECONDS_TO_REACH[clamped];
}

/** De server accepteert alleen scores die fysiek binnen de verstreken tijd passen. */
export function maxPlausibleScore(startedAt: Date, now: Date): number {
  const elapsedSeconds = Math.max(0, (now.getTime() - startedAt.getTime()) / 1000);
  let low = 1;
  let high = MAX_RUN_SCORE;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (MIN_SECONDS_TO_REACH[mid] <= elapsedSeconds) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function validateReportedScore(startedAt: Date, now: Date, previousScore: number, reportedScore: number): { ok: true; score: number } | { ok: false; reason: string } {
  if (!Number.isInteger(reportedScore) || reportedScore < 0 || reportedScore > MAX_RUN_SCORE) return { ok: false, reason: "INVALID_SCORE" };
  if (reportedScore < previousScore) return { ok: false, reason: "SCORE_DECREASED" };
  if (reportedScore > maxPlausibleScore(startedAt, now)) return { ok: false, reason: "SCORE_TOO_FAST" };
  return { ok: true, score: reportedScore };
}
