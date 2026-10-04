export interface ScoreRun {
  userId: string;
  score: number;
  finishedAt: Date;
}

export function bestScoresPerUser(runs: ScoreRun[]): ScoreRun[] {
  const best = new Map<string, ScoreRun>();
  for (const run of runs) {
    const old = best.get(run.userId);
    if (!old || run.score > old.score || (run.score === old.score && run.finishedAt < old.finishedAt)) best.set(run.userId, run);
  }
  return [...best.values()];
}

export function rankScores(runs: ScoreRun[]): ScoreRun[] {
  return bestScoresPerUser(runs).sort((a, b) => b.score - a.score || a.finishedAt.getTime() - b.finishedAt.getTime() || a.userId.localeCompare(b.userId));
}
