/**
 * Weergave van een puzzeltijd. Alleen afronden (naar beneden) voor het tonen; sorteren gebeurt op de officiële
 * milliseconden. Onder een minuut staat er een tiende seconde bij, zodat zeer snelle tijden niet allemaal "0:00" zijn.
 */
export function formatPuzzleTime(ms: number): string {
  const clamped = Math.max(0, ms);
  const two = (n: number) => String(n).padStart(2, "0");
  if (clamped < 60_000) return `0:${two(Math.floor(clamped / 1000))}.${Math.floor((clamped % 1000) / 100)}`;
  const total = Math.floor(clamped / 1000);
  const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60;
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
