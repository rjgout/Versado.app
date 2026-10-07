/**
 * Alleen voor ontwikkeling (`?debugDifficulty=700`, nooit in productie; zie
 * RunClient): laat opening en wereldsnelheid zo spelen als bij die score, zonder
 * dat de echte score of wat naar de server gaat verandert. De server weigert
 * dan na enkele punten een te snelle score; dit is dus alleen om te bekijken.
 */
export function parseDebugDifficultyScore(search: string): number | null {
  const raw = new URLSearchParams(search).get("debugDifficulty");
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  return Number(raw);
}
