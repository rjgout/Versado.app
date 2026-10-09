// Wat telt als leeractiviteit voor de dagelijkse reeks. De enige plek met
// deze regel: elke afrondfunctie (streak.ts, contentProgress.ts) vraagt het
// hier na voordat de reeks wordt bijgewerkt, en geen pagina past de reeks
// zelf aan.
//
// De regel: "Ik heb vandaag minimaal één echte inhoudelijke activiteit in
// Versado afgerond." Moeilijkheid, lengte, XP, score en aantal minuten
// maken niet uit; wel dat de activiteit echt is afgerond, op de server is
// gecontroleerd en een vaste activiteitssleutel heeft (zie
// recordLearningActivity). Alleen openen, bladeren, scrollen, een podcast
// starten of een instelling wijzigen telt niet. De eerste afronding van de
// kalenderdag verlengt de reeks, latere afrondingen diezelfde dag niet.
//
// Lezen telt alleen als een uitdrukkelijke afronding (hoofdstuk als gelezen
// geregistreerd, leesstap zonder vragen afgerond): één afronding van één
// stuk inhoud, nooit het openen of doorscrollen. Een activiteit met vragen
// of zetten telt pas als hij is afgerond, met minstens één beantwoorde vraag
// (of zet) en alles wat de activiteit vraagt.

import { daysBetween } from "@/lib/dates";
import { dayKeyInZone, LEGACY_DAY_TIME_ZONE, resolveTimeZone } from "@/lib/timeZone";

export type LearningActivityKind =
  // Een uitdrukkelijk afgeronde leesactiviteit: hoofdstuk als gelezen
  // geregistreerd of een leesstap zonder vragen afgerond (answered = 1).
  | "READING"
  // Oefeningen bij inhoud: een oefenset of een stap van een leesroute.
  | "CONTENT_EXERCISES"
  // Een les uit een cursus met eigen vragen (podcast, kinderen, introductie).
  | "COURSE_LESSON"
  // Een korte oefenronde zonder vaste inhoud.
  | "PRACTICE"
  // Een afgerond educatief spel (live quiz, raad het hoofdstuk, woordspel, ...).
  | "GAME";

export interface LearningActivity {
  kind: LearningActivityKind;
  /** Hoeveel vragen, beurten of zetten er echt zijn gedaan. */
  answered: number;
  /** Hoeveel de activiteit er vraagt om als afgerond te tellen. */
  required: number;
}

export function qualifiesForStreak(activity: LearningActivity): boolean {
  return activity.answered >= 1 && activity.answered >= activity.required;
}

// --- Welke dag is het voor de reeks? --------------------------------------
//
// Een reeksdag is een kalenderdag in de tijdzone van de gebruiker. Omdat
// iemand kan reizen (of de tijdzone van zijn toestel kan veranderen), kijkt
// de regel naar twee tijdzones: die van nu, en die waarin de laatste
// reeksdag is behaald. Een dag is pas nieuw als hij in BEIDE nieuw is, en
// pas gemist als hij in BEIDE gemist is. Zo levert een tijdzonewissel nooit
// een extra dag op en kost hij nooit een behaalde dag.
//
// Reeksgegevens van vóór de tijdzones hebben geen opgeslagen tijdzone; die
// zijn vastgelegd als UTC-dag (LEGACY_DAY_TIME_ZONE), dus daarmee rekenen we
// voor die laatste dag.

export interface StreakDayState {
  lastStudyDate: string | null;
  /** Tijdzone waarin lastStudyDate is behaald; null = van vóór de tijdzones (UTC-dag). */
  lastStudyTimeZone: string | null;
  /** Huidige tijdzone van de gebruiker; null = nog niet bekend (standaard). */
  timeZone: string | null;
}

export interface StreakDayGap {
  /** De kalenderdag van nu in de huidige tijdzone: de sleutel voor een nieuwe reeksdag. */
  today: string;
  /**
   * Dagen sinds de laatste reeksdag, voorzichtig gerekend (het minimum van
   * beide tijdzones). 0 of minder: vandaag telt al. 1: aansluitende dag.
   * Meer: gap - 1 gemiste dagen. null: nog nooit een reeksdag.
   */
  gap: number | null;
}

export function streakDayGap(state: StreakDayState, now: Date): StreakDayGap {
  const currentZone = resolveTimeZone(state.timeZone);
  const today = dayKeyInZone(now, currentZone);
  if (!state.lastStudyDate) return { today, gap: null };
  const lastZone = state.lastStudyTimeZone ?? LEGACY_DAY_TIME_ZONE;
  const gapNow = daysBetween(state.lastStudyDate, today);
  const gapThen = daysBetween(state.lastStudyDate, dayKeyInZone(now, lastZone));
  return { today, gap: Math.min(gapNow, gapThen) };
}

/** Telt vandaag al voor de reeks? */
export function hasStudiedToday(state: StreakDayState, now: Date = new Date()): boolean {
  const { gap } = streakDayGap(state, now);
  return gap !== null && gap <= 0;
}
