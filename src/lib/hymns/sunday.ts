import { dayKeyInZone, localDayRange, zonedParts } from "@/lib/timeZone";

// Het zondagse zangboek is een ingang naar een activiteit, geen wissel van contentcollectie.
// Alleen de kalenderdag in de opgeslagen IANA-tijdzone van de gebruiker telt.
export function isSundayInTimeZone(now: Date, timeZone: string): boolean {
  return zonedParts(now, timeZone).weekday === 0;
}

/**
 * Of de zondagkaart op Vandaag getoond wordt. De toegang wordt pas opgevraagd als het in de eigen tijdzone zondag is,
 * zodat de andere zes dagen geen extra databasequery kosten. De servergate (`getHymnsAccess`) beslist; deze functie
 * kent zelf geen uitzonderingen en omzeilt dus nooit beheerschakelaar of noodstop.
 */
export async function sundayHymnsVisible(now: Date, timeZone: string, resolveAccess: () => Promise<string>): Promise<boolean> {
  return isSundayInTimeZone(now, timeZone) && (await resolveAccess()) === "allow";
}

/**
 * Het moment waarop een gerenderde Vandaag-pagina niet meer klopt: de eerstvolgende lokale middernacht (ook op de dag van een
 * zomer-/wintertijdwissel, dan is de dag 23 of 25 uur) of, als die eerder komt, de bestaande woord-van-de-dag-release.
 */
export function todayRefreshExpiry(now: Date, timeZone: string, wordReleaseAt?: string | null): string {
  const midnight = localDayRange(dayKeyInZone(now, timeZone), timeZone).end.toISOString();
  return wordReleaseAt && wordReleaseAt < midnight ? wordReleaseAt : midnight;
}
