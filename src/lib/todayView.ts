import type { TodayData } from "./today";
/** Alleen afgerond als alle expliciete dagelijkse verplichtingen klaar zijn. */
export function isTodayComplete(data: Pick<TodayData, "streak" | "actions" | "actionTotal" | "wordGame" | "dailyQuiz">): boolean {
  return (
    data.streak.studiedToday &&
    data.actionTotal === 0 &&
    [data.wordGame, data.dailyQuiz].every((game) => game === null || game.status === "done")
  );
}

