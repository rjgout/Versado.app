import type { StreakContinuationView } from "@/lib/learning/streakReturnRules";

export interface EarnedStreakBanner {
  dayKey: string;
  streak: number;
}

/** Alleen een nieuwe, door de server bevestigde reeksdag; een eerste paginaweergave is geen verdienmoment. */
export function earnedStreakBanner(
  previous: StreakContinuationView | null,
  next: StreakContinuationView,
  earnedEvent: boolean,
): EarnedStreakBanner | null {
  if (next.status !== "ACTIVE" || !next.studiedToday || next.currentStreak < 1) return null;
  const changed = previous !== null && previous.currentStreak < next.currentStreak;
  return earnedEvent || changed ? { dayKey: next.day, streak: next.currentStreak } : null;
}
