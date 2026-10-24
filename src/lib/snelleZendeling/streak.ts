import type { Prisma } from "@/generated/prisma/client";
import { recordLearningActivity } from "@/lib/streak";
import { emitToUser } from "@/lib/realtime";

export interface RunStreakEvent {
  userId: string;
  dayEarned: boolean;
  currentStreak: number;
}

/** Alleen gespeelde, definitief afgeronde runs; starten en meteen sluiten telt niet. */
export async function recordFinishedRun(tx: Prisma.TransactionClient, run: {
  id: string; userId: string; score: number; status: string; contentCollectionId: string | null;
  reviveUsed: boolean; played?: boolean; eliminatedHow?: string | null;
}, at: Date): Promise<RunStreakEvent | null> {
  // Een oude sessie zonder bewezen bron wordt bij openen alleen veilig gesloten.
  // Die automatische opruiming is geen nieuwe, gevalideerde spelafronding.
  if (!run.contentCollectionId) return null;
  const played = run.played || run.score > 0 || run.reviveUsed || run.status === "DEAD_AWAITING_REVIVE" || run.status === "REVIVE_READY"
    || run.eliminatedHow === "CRASH" || run.eliminatedHow === "GENEES_WRONG";
  if (!played) return null;
  const result = await recordLearningActivity(tx, run.userId, {
    kind: "GAME", answered: 1, required: 1, key: `quick-missionary:${run.id}`,
  }, at);
  return result.duplicate ? null : { userId: run.userId, dayEarned: result.dayEarned, currentStreak: result.currentStreak };
}

/** Pas na commit uitzenden. */
export function announceRunStreaks(events: RunStreakEvent[]): void {
  for (const { userId, ...event } of events) emitToUser(userId, "streak_changed", event);
}
