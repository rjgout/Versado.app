// Vaste regels van Samen (vriendenreeksen, groepen, seintjes). Puur: geen
// database, veilig in client components en in de eager-keten van server.ts.
// Zie docs/SAMEN.md.

import { addDays } from "@/lib/dates";
import { dayKeyInZone, LEGACY_DAY_TIME_ZONE, resolveTimeZone, startOfLocalDay } from "@/lib/timeZone";

export const FRIEND_STREAK_LIMIT = 5;
export const GROUP_LIMIT_PER_USER = 10;
/** Bovengrens per groep. Alleen hier vastgelegd: verhogen is deze waarde aanpassen. */
export const GROUP_MAX_MEMBERS = 500;
/** Zoveel leden moeten er meetellen voor een lopende groepsreeks; daaronder staat hij stil. */
export const GROUP_MIN_MEMBERS = 3;
export const GROUP_NAME_MAX_LENGTH = 60;
export const GROUP_REJOIN_COOLDOWN_DAYS = 7;
export const GROUP_FREEZE_COOLDOWN_DAYS = 30;
export const ADMIN_INACTIVE_DAYS = 14;
export const NUDGE_INTERVAL_HOURS = 6;

// Groepslink/QR en toegangsverzoeken (zie joinLinks.ts).
/** 32 willekeurige bytes: 256 bits, als base64url 43 tekens. Niet te raden, en een ingetrokken token komt nooit terug. */
export const GROUP_LINK_TOKEN_BYTES = 32;
/** Na een geweigerd verzoek zoveel dagen geen nieuw verzoek voor dezelfde groep. */
export const JOIN_REQUEST_DECLINE_COOLDOWN_DAYS = 3;
/** Hooguit zoveel nieuwe toegangsverzoeken per persoon per uur (over alle groepen). */
export const JOIN_REQUEST_HOURLY_LIMIT = 5;

export const FRIEND_STREAK_MILESTONES = [1, 7, 30, 100, 365] as const;
export const GROUP_STREAK_MILESTONES = [7, 30, 100, 365] as const;

/**
 * Het percentage van de leden dat op een dag moet bijdragen: hoe groter de
 * groep, hoe toleranter. Een implementatiedetail; de app toont aantallen.
 */
export function requiredPercentage(eligible: number): number {
  return 45 + 55 / Math.sqrt(eligible);
}

/**
 * Hoeveel leden er op een groepsdag moeten bijdragen. Bij precies 3 leden
 * altijd alle 3; onder de 3 is er geen lopende reeks (null).
 */
export function requiredContributors(eligible: number): number | null {
  if (!Number.isInteger(eligible) || eligible < GROUP_MIN_MEMBERS) return null;
  if (eligible === GROUP_MIN_MEMBERS) return GROUP_MIN_MEMBERS;
  // Kleine marge tegen afrondingsruis: 25 leden x 56% is precies 14, niet 15.
  return Math.min(eligible, Math.ceil((eligible * requiredPercentage(eligible)) / 100 - 1e-9));
}

// --- Wanneer is een dag van één persoon definitief? ------------------------
//
// Een sociale reeksdag D telt per persoon op diens eigen kalenderdag D. Of
// iemand D heeft behouden, staat in StreakDay (gestudeerd of bevroren). Zo'n
// rij voor een gemiste dag (bevroren) komt pas nadat D voorbij is, via de
// reeksafsluiting in scheduler.ts of bij de volgende studiedag. Daarom is
// "geen rij" pas definitief "niet behouden" als D voor die persoon in beide
// tijdzones van de reeksregel voorbij is (zie streakRules.ts) en de eigen
// reeks die dag al heeft verwerkt.

export interface MemberDayInput {
  /** Heeft deze persoon een StreakDay voor dag D? */
  kept: boolean;
  timeZone: string | null;
  lastStudyDate: string | null;
  lastStudyTimeZone: string | null;
  currentStreak: number;
  streakInterruptedDay?: string | null;
}

export type MemberDayOutcome = "kept" | "missed" | "pending";

/** Dag D is overal ter wereld voorbij (de laatste tijdzone is UTC-12), met een kleine marge voor de reeksafsluiting. */
export function dayOverEverywhere(dayKey: string, now: Date): boolean {
  return now.getTime() >= Date.parse(`${addDays(dayKey, 1)}T12:00:00Z`) + 15 * 60_000;
}

export function memberDayOutcome(member: MemberDayInput, dayKey: string, now: Date): MemberDayOutcome {
  if (member.kept) return "kept";
  if (dayOverEverywhere(dayKey, now)) return "missed";
  if (dayKeyInZone(now, resolveTimeZone(member.timeZone)) <= dayKey) return "pending";
  if (member.lastStudyDate) {
    if (dayKeyInZone(now, member.lastStudyTimeZone ?? LEGACY_DAY_TIME_ZONE) <= dayKey) return "pending";
    // Een lopende reeks met een oudere laatste dag: de reeksafsluiting moet
    // de gemiste dagen nog bevriezen of als onderbreking verwerken.
    if (member.currentStreak > 0 && !member.streakInterruptedDay && member.lastStudyDate < dayKey) return "pending";
  }
  return "missed";
}

/** Het vroegste moment waarop dag D voor iedereen met deze tijdzones voorbij is. */
export function dayEndsForAll(dayKey: string, timeZones: (string | null)[]): Date {
  const next = addDays(dayKey, 1);
  let latest = startOfLocalDay(next, resolveTimeZone(null)).getTime();
  for (const zone of timeZones) latest = Math.max(latest, startOfLocalDay(next, resolveTimeZone(zone)).getTime());
  return new Date(latest);
}

/** De nieuwste kalenderdag die nu ergens ter wereld al begonnen is. */
export function latestDayKey(now: Date): string {
  return dayKeyInZone(now, "Pacific/Kiritimati");
}

// --- De uitkomst van een sociale reeksdag ---------------------------------

export type SocialDayOutcome = "achieved" | "protected" | "paused" | "missed" | "pending";

export interface SocialDayInput {
  eligible: number;
  contributors: number;
  /** Zijn alle meetellende leden voor deze dag definitief (kept of missed)? */
  settled: boolean;
  /** Is er een reeksbevriezing aangeboden voor deze dag (alleen groepen)? */
  freezeReserved: boolean;
  /** Vriendenreeks: altijd 2 van 2. Groep: de formule hierboven. */
  required: number | null;
}

/**
 * Eén regel voor vriendenreeksen en groepsreeksen. Gehaald zodra genoeg
 * mensen hebben bijgedragen (ook al tijdens de dag: dat is definitief). Pas
 * als iedereen definitief is: gepauzeerd (te weinig leden), beschermd (een
 * aangeboden bevriezing) of gemist.
 */
export function resolveSocialDay(input: SocialDayInput): SocialDayOutcome {
  if (input.required !== null && input.contributors >= input.required) return "achieved";
  if (!input.settled) return "pending";
  if (input.required === null) return "paused";
  if (input.freezeReserved) return "protected";
  return "missed";
}
