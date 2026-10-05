export type ReviveRunStatus = "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED";

export interface ReviveOptionCandidate {
  id: string;
  label: string;
  isCorrect: boolean;
}

function answerShape(label: string): { characters: number; words: number } {
  const normalized = label.trim().replace(/\s+/g, " ");
  return { characters: normalized.length, words: normalized ? normalized.split(" ").length : 0 };
}

/**
 * Een antwoordset is bruikbaar als één optie niet door louter lengte of
 * informatiedichtheid evident afwijkt. Dit verandert nooit de content zelf:
 * uit bestaande afleiders wordt de geloofwaardigste combinatie gekozen.
 */
export function reviveOptionsAreComparable(options: ReviveOptionCandidate[]): boolean {
  if (options.length !== 3 || options.some((option) => !option.label.trim())) return false;
  const shapes = options.map((option) => answerShape(option.label));
  const characters = shapes.map((shape) => shape.characters);
  const words = shapes.map((shape) => shape.words);
  const shortest = Math.min(...characters);
  const longest = Math.max(...characters);
  return shortest > 0 && longest / shortest <= 2.5 && Math.max(...words) - Math.min(...words) <= 10;
}

/** Selecteert exact één goed en twee vergelijkbare foute opties voor Genees. */
export function selectReviveOptions(options: ReviveOptionCandidate[]): ReviveOptionCandidate[] | null {
  const correct = options.filter((option) => option.isCorrect);
  const wrong = options.filter((option) => !option.isCorrect);
  if (correct.length !== 1 || wrong.length < 2) return null;

  const candidates: ReviveOptionCandidate[][] = [];
  for (let first = 0; first < wrong.length - 1; first++) {
    for (let second = first + 1; second < wrong.length; second++) {
      const set = [correct[0], wrong[first], wrong[second]];
      if (reviveOptionsAreComparable(set)) candidates.push(set);
    }
  }
  if (candidates.length === 0) return null;

  const correctLength = answerShape(correct[0].label).characters;
  const distance = (set: ReviveOptionCandidate[]) => set.slice(1).reduce(
    (sum, option) => sum + Math.abs(answerShape(option.label).characters - correctLength),
    0
  );
  candidates.sort((a, b) => distance(a) - distance(b));
  return candidates[0];
}

export interface ReviveQuestionContextSource {
  chapter?: { number: number; book?: { name: string } | null } | null;
}

/** Alleen echte gekoppelde contentmetadata tonen; zonder bron blijft context leeg. */
export function reviveQuestionContext(source: ReviveQuestionContextSource): { kind: "chapter"; label: string } | null {
  const chapter = source.chapter;
  const name = chapter?.book?.name.trim();
  return chapter && name ? { kind: "chapter", label: `${name} ${chapter.number}` } : null;
}

export function applyReviveAnswer(status: ReviveRunStatus, reviveUsed: boolean, correct: boolean): ReviveRunStatus | null {
  if (status !== "DEAD_AWAITING_REVIVE" || reviveUsed) return null;
  return correct ? "REVIVE_READY" : "FINISHED";
}
