import { addDays, daysBetween } from "@/lib/dates";
import { dayKeyInZone, LEGACY_DAY_TIME_ZONE, resolveTimeZone } from "@/lib/timeZone";
import { streakDayGap, type StreakDayState } from "@/lib/learning/streakRules";

// Ondergrenzen van volledig gemiste, onbevroren kalenderdagen. Geen deadline.
export const STREAK_RETURN_REQUIREMENTS = [
  [1, 3], [3, 4], [7, 5], [14, 6], [30, 7],
  [60, 8], [90, 9], [180, 10], [365, 11], [730, 12],
] as const;
export const STREAK_RETURN_REMINDER_DAYS = [1, 3, 7, 14, 30, 60, 120, 240, 365] as const;
export const STREAK_RETURN_YEAR_DAYS = 365;

export function returnActivitiesRequired(absentDays: number): number {
  let result: number = STREAK_RETURN_REQUIREMENTS[0][1];
  for (const [days, required] of STREAK_RETURN_REQUIREMENTS) {
    if (absentDays >= days) result = required;
  }
  return result;
}

/** Alleen het nieuwste verstreken moment; na downtime nooit een stapel oude herinneringen. */
export function dueReturnReminder(absentDays: number, lastSentDay: number): number | null {
  const day = absentDays >= STREAK_RETURN_YEAR_DAYS
    ? Math.floor(absentDays / STREAK_RETURN_YEAR_DAYS) * STREAK_RETURN_YEAR_DAYS
    : [...STREAK_RETURN_REMINDER_DAYS].reverse().find((n) => n <= absentDays) ?? 0;
  return day > lastSentDay ? day : null;
}

export interface ContinuationState extends StreakDayState {
  currentStreak: number;
  freezeCount: number;
  streakGraceDay: string | null;
  streakInterruptedDay: string | null;
  streakReturnDay: string | null;
  streakReturnTimeZone: string | null;
  streakReturnCount: number;
  streakReturnRequired: number;
}

/** De uitrolgrens beschermt bestaande data zonder historische studiedagen te verzinnen. */
export function streakAnchor(user: ContinuationState): StreakDayState {
  if (user.streakGraceDay && (!user.lastStudyDate || user.streakGraceDay > user.lastStudyDate)) {
    return { ...user, lastStudyDate: user.streakGraceDay, lastStudyTimeZone: resolveTimeZone(user.timeZone) };
  }
  return user;
}

export function missedDayPlan(user: ContinuationState, now: Date) {
  const anchor = streakAnchor(user);
  const gap = streakDayGap(anchor, now).gap;
  const missed = !user.streakInterruptedDay && user.currentStreak > 0 && anchor.lastStudyDate
    ? Math.max(0, (gap ?? 0) - 1) : 0;
  const freezes = Math.min(user.freezeCount, missed);
  return {
    freezes,
    frozenDays: Array.from({ length: freezes }, (_, i) => addDays(anchor.lastStudyDate!, i + 1)),
    interruptedDay: missed > freezes ? addDays(anchor.lastStudyDate!, freezes + 1) : null,
  };
}

export function interruptionDays(user: ContinuationState, now: Date): number {
  if (!user.streakInterruptedDay) return 0;
  const anchor = streakAnchor(user);
  return Math.max(1, Math.min(
    daysBetween(user.streakInterruptedDay, dayKeyInZone(now, resolveTimeZone(user.timeZone))),
    daysBetween(user.streakInterruptedDay, dayKeyInZone(now, anchor.lastStudyTimeZone ?? LEGACY_DAY_TIME_ZONE)),
  ));
}

export function sameReturnDay(user: ContinuationState, now: Date): boolean {
  if (!user.streakReturnDay) return false;
  // Zodra een van de twee lokale dagen voorbij is begint de poging opnieuw:
  // reizen mag een onafgemaakte opdracht niet over middernacht heen bewaren.
  return dayKeyInZone(now, resolveTimeZone(user.timeZone)) === user.streakReturnDay
    && dayKeyInZone(now, resolveTimeZone(user.streakReturnTimeZone)) === user.streakReturnDay;
}

export interface StreakContinuationView {
  status: "ACTIVE" | "INTERRUPTED";
  currentStreak: number;
  day: string;
  interruptedDay: string | null;
  completed: number;
  required: number;
  studiedToday: boolean;
}

export function continuationView(user: ContinuationState, now: Date): StreakContinuationView {
  const gap = streakDayGap(user, now);
  const interrupted = user.streakInterruptedDay !== null;
  const sameDay = sameReturnDay(user, now);
  return {
    status: interrupted ? "INTERRUPTED" : "ACTIVE",
    currentStreak: user.currentStreak,
    day: gap.today,
    interruptedDay: user.streakInterruptedDay,
    completed: interrupted && sameDay ? user.streakReturnCount : 0,
    required: interrupted ? (sameDay ? user.streakReturnRequired : returnActivitiesRequired(interruptionDays(user, now))) : 0,
    studiedToday: !interrupted && gap.gap !== null && gap.gap <= 0,
  };
}
