export type ReviveRunStatus = "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED";

export interface ReviveOptionCandidate {
  id: string;
  label: string;
  isCorrect: boolean;
}

/** Selecteert exact één goed en twee foute opties voor de kennis-revive. */
export function selectReviveOptions(options: ReviveOptionCandidate[]): ReviveOptionCandidate[] | null {
  const correct = options.find((option) => option.isCorrect);
  const wrong = options.filter((option) => !option.isCorrect).slice(0, 2);
  return correct && wrong.length === 2 ? [correct, ...wrong] : null;
}

export function applyReviveAnswer(status: ReviveRunStatus, reviveUsed: boolean, correct: boolean): ReviveRunStatus | null {
  if (status !== "DEAD_AWAITING_REVIVE" || reviveUsed) return null;
  return correct ? "REVIVE_READY" : "FINISHED";
}
