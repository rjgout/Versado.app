export interface ExerciseProgress {
  answered: number;
  total: number;
  percent: number;
}

/** Dezelfde progressieregel voor elke cursusvraag, vóór en na controleren. */
export function exerciseProgress(current: number, total: number, checked: boolean): ExerciseProgress {
  const safeTotal = Math.max(0, total);
  const answered = Math.min(safeTotal, Math.max(0, current + (checked ? 1 : 0)));
  return {
    answered,
    total: safeTotal,
    percent: safeTotal === 0 ? 0 : Math.round((answered / safeTotal) * 100),
  };
}
