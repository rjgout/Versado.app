/** Weergave van een puzzeltijd. Alleen afronden voor de weergave; sorteren gebeurt op de officiële milliseconden. */
export function formatPuzzleTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600); const minutes = Math.floor((total % 3600) / 60); const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}
