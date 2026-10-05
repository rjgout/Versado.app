export interface StoredMysteryCompletion {
  completed: true;
  completedAt: Date;
  hintCount: number;
  tutorialSeenAt: Date;
}

/** Pure first-completionbesluit, zodat retries/replays nooit historie wijzigen. */
export function firstCompletionUpdate(alreadyCompleted: boolean, hintCount: number, at: Date): StoredMysteryCompletion | null {
  if (alreadyCompleted) return null;
  return { completed: true, completedAt: at, hintCount, tutorialSeenAt: at };
}

