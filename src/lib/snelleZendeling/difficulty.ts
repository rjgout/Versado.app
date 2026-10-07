/**
 * Moeilijkheidscurve van Vliegende Versado. Eén pure functie die client (spawn
 * van obstakels, wereldsnelheid) en server (maximaal plausibele score) delen,
 * zodat er nooit twee afwijkende tabellen bestaan.
 *
 * De curve hangt uitsluitend af van de actuele score van déze run: geen record,
 * XP, mascotte of vaardigheid. De opening is de primaire moeilijkheid; de
 * horizontale snelheid stijgt hooguit 5%. Vanaf MAX_DIFFICULTY_SCORE blijft
 * alles constant. Deze punten zijn bewust vastgelegd om in de praktijk te
 * testen: wijzig ze alleen na een bewuste speelbeslissing.
 */
export interface DifficultyPoint {
  score: number;
  /** Aandeel van de basisopening (GAP_HEIGHT); 1 = 100%. */
  gap: number;
  /** Aandeel van de basissnelheid (HORIZONTAL_SPEED); 1 = 100%. */
  speed: number;
}

export const DIFFICULTY_POINTS: readonly DifficultyPoint[] = [
  { score: 0, gap: 1.0, speed: 1.0 },
  { score: 50, gap: 0.96, speed: 1.005 },
  { score: 100, gap: 0.92, speed: 1.01 },
  { score: 200, gap: 0.88, speed: 1.015 },
  { score: 300, gap: 0.84, speed: 1.02 },
  { score: 400, gap: 0.81, speed: 1.025 },
  { score: 500, gap: 0.78, speed: 1.03 },
  { score: 600, gap: 0.76, speed: 1.035 },
  { score: 700, gap: 0.74, speed: 1.04 },
  { score: 800, gap: 0.72, speed: 1.045 },
  { score: 1000, gap: 0.7, speed: 1.05 },
];

export const MAX_DIFFICULTY_SCORE = DIFFICULTY_POINTS[DIFFICULTY_POINTS.length - 1].score;
/** Harde ondergrens van de opening en bovengrens van de snelheid. */
export const MIN_GAP_MULTIPLIER = 0.7;
export const MAX_SPEED_MULTIPLIER = 1.05;

export interface Difficulty {
  gapMultiplier: number;
  speedMultiplier: number;
}

/**
 * Stuksgewijs lineair tussen de punten: geen stappen, geen toeval, geen tijd.
 * Een ongeldige of negatieve score telt als 0; vanaf het laatste punt is het
 * resultaat constant.
 */
export function getDifficulty(score: number): Difficulty {
  const value = Number.isFinite(score) && score > 0 ? score : 0;
  const last = DIFFICULTY_POINTS[DIFFICULTY_POINTS.length - 1];
  if (value >= last.score) return { gapMultiplier: last.gap, speedMultiplier: last.speed };
  let index = 0;
  while (DIFFICULTY_POINTS[index + 1].score <= value) index++;
  const from = DIFFICULTY_POINTS[index];
  const to = DIFFICULTY_POINTS[index + 1];
  const t = (value - from.score) / (to.score - from.score);
  return {
    gapMultiplier: from.gap + (to.gap - from.gap) * t,
    speedMultiplier: from.speed + (to.speed - from.speed) * t,
  };
}
