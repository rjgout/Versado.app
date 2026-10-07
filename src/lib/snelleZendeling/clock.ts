/**
 * Klokcorrectie voor de gezamenlijke tijdlijn. De wereld loopt op servertijd;
 * de klok van een toestel mag daar seconden van afwijken. Een meting stuurt een
 * verzoek (sentAt, eigen klok), de server antwoordt met zijn tijd, de client
 * leest het antwoord (receivedAt, eigen klok). Aangenomen wordt dat heen en
 * terug even lang duren; de meting met de kortste rondreis is de nauwkeurigste.
 */
export interface ClockSample {
  sentAt: number;
  receivedAt: number;
  serverNow: number;
}

/** Hoeveel ms servertijd voorloopt op de eigen klok (negatief: de eigen klok loopt voor). */
export function estimateClockOffset(samples: ClockSample[]): number | null {
  let best: { rtt: number; offset: number } | null = null;
  for (const sample of samples) {
    const rtt = sample.receivedAt - sample.sentAt;
    if (!Number.isFinite(rtt) || rtt < 0) continue;
    const offset = sample.serverNow + rtt / 2 - sample.receivedAt;
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  return best ? best.offset : null;
}
