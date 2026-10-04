import { HORIZONTAL_SPEED, PAIR_SPACING } from "./gameplay";

// De server accepteert alleen scores die fysiek binnen de minimale afstand
// tussen twee paren passen. Een cliënt kan dus geen willekeurig getal posten.
export const MIN_SECONDS_PER_POINT = PAIR_SPACING / HORIZONTAL_SPEED;
export const MAX_RUN_SCORE = 10_000;

export function maxPlausibleScore(startedAt: Date, now: Date): number {
  const elapsedSeconds = Math.max(0, (now.getTime() - startedAt.getTime()) / 1000);
  return Math.min(MAX_RUN_SCORE, Math.floor(elapsedSeconds / MIN_SECONDS_PER_POINT) + 1);
}

export function validateReportedScore(startedAt: Date, now: Date, previousScore: number, reportedScore: number): { ok: true; score: number } | { ok: false; reason: string } {
  if (!Number.isInteger(reportedScore) || reportedScore < 0 || reportedScore > MAX_RUN_SCORE) return { ok: false, reason: "INVALID_SCORE" };
  if (reportedScore < previousScore) return { ok: false, reason: "SCORE_DECREASED" };
  if (reportedScore > maxPlausibleScore(startedAt, now)) return { ok: false, reason: "SCORE_TOO_FAST" };
  return { ok: true, score: reportedScore };
}
