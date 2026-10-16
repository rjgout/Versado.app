import { zonedParts } from "@/lib/timeZone";

// Het zondagse zangboek is een ingang naar een activiteit, geen wissel van contentcollectie.
// Alleen de kalenderdag in de opgeslagen IANA-tijdzone van de gebruiker telt.
export function isSundayInTimeZone(now: Date, timeZone: string): boolean {
  return zonedParts(now, timeZone).weekday === 0;
}
