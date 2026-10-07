/**
 * De regels van een gezamenlijke run, puur en zonder database: welke toestand
 * een deelnemer heeft, wanneer de run voorbij is, wie de laatste twee zijn.
 * runs.ts/match.ts voeren deze regels uit onder een rijvergrendeling.
 *
 * Toestanden (zie ook docs/SNELLE-ZENDELING.md):
 * - ACTIVE          vliegt (run.status IN_PROGRESS).
 * - REVIVE_PENDING  is gebotst en wacht op of beantwoordt een Genees-vraag, of
 *                   mag nog hervatten (run.status DEAD_AWAITING_REVIVE of
 *                   REVIVE_READY). Telt nog mee in de wedstrijd.
 * - ELIMINATED      definitief afgevallen (run.status FINISHED met eliminatedSeq).
 * - FINISHED        de laatste overlevende (run.status FINISHED zonder eliminatedSeq).
 */
export type ParticipantState = "ACTIVE" | "REVIVE_PENDING" | "ELIMINATED" | "FINISHED";

export type RunStatusLike = "IN_PROGRESS" | "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED";

export function participantState(run: { status: RunStatusLike; eliminatedSeq: number | null }): ParticipantState {
  if (run.status === "IN_PROGRESS") return "ACTIVE";
  if (run.status === "DEAD_AWAITING_REVIVE" || run.status === "REVIVE_READY") return "REVIVE_PENDING";
  return run.eliminatedSeq === null ? "FINISHED" : "ELIMINATED";
}

/** Doet deze deelnemer nog mee (kan nog winnen of terugkomen)? */
export function stillInContention(state: ParticipantState): boolean {
  return state === "ACTIVE" || state === "REVIVE_PENDING";
}

export type MatchDecision =
  | { over: false }
  | {
      over: true;
      /** LAST_STANDING: één speler vliegt nog. NOBODY_FLYING: wie nog meedoet wacht op een Genees die niet meer kan. */
      reason: "LAST_STANDING" | "NOBODY_FLYING";
      /** De winnaar (ACTIVE), anders null. */
      survivorId: string | null;
      /** Wie nog op een Genees wachtte; die kan niet meer terugkomen. */
      voidedIds: string[];
    };

/**
 * De run duurt tot er nog één deelnemer meedoet. Een deelnemer in REVIVE_PENDING
 * doet nog mee: dat is wat een Genees "uitstel van eliminatie" maakt. Blijft
 * alleen zo iemand over, dan vliegt er niemand meer: de run is voorbij en de
 * Genees kan hem niet meer terugbrengen (nooit resurrecten na afsluiting).
 */
export function decideMatch(participants: { userId: string; state: ParticipantState; reviveGranted?: boolean }[]): MatchDecision {
  const inGame = participants.filter((p) => stillInContention(p.state));
  if (inGame.length > 1) return { over: false };
  const [last] = inGame;
  if (!last) return { over: true, reason: "NOBODY_FLYING", survivorId: null, voidedIds: [] };
  // Een goed Genees-antwoord (REVIVE_READY) is al verdiend voordat de anderen
  // wegvielen: die speler vliegt gewoon verder en wint dus, hij wordt niet
  // alsnog uitgesloten omdat hij nog niet op "doorgaan" tikte.
  if (last.state === "ACTIVE" || last.reviveGranted) return { over: true, reason: "LAST_STANDING", survivorId: last.userId, voidedIds: [] };
  return { over: true, reason: "NOBODY_FLYING", survivorId: null, voidedIds: [last.userId] };
}

export interface RankedParticipant {
  userId: string;
  score: number;
  /** null = nooit afgevallen (de overlevende). */
  eliminatedSeq: number | null;
}

/**
 * Wie het langst meedeed staat vooraan: de overlevende eerst, daarna aflopend
 * op eliminatievolgorde. De volgorde is totaal: elke eliminatie krijgt onder de
 * wedstrijdvergrendeling een eigen volgnummer, dus er zijn geen gelijke standen.
 */
export function survivalOrder<T extends RankedParticipant>(participants: T[]): T[] {
  return [...participants].sort((a, b) => (b.eliminatedSeq ?? Number.POSITIVE_INFINITY) - (a.eliminatedSeq ?? Number.POSITIVE_INFINITY));
}

export interface DuoPair {
  /** Gesorteerd op userId, zodat hetzelfde duo altijd dezelfde A en B heeft. */
  a: RankedParticipant;
  b: RankedParticipant;
}

/**
 * Het duo = de laatste twee deelnemers. Bij precies twee deelnemers zijn dat
 * automatisch beiden. Wie eerder afviel (ELIMINATED vóór het veld tot twee
 * kromp) zit er nooit in. Een wedstrijd met één deelnemer heeft geen duo.
 */
export function deriveDuo(participants: RankedParticipant[]): DuoPair | null {
  if (participants.length < 2) return null;
  const [first, second] = survivalOrder(participants);
  return first.userId < second.userId ? { a: first, b: second } : { a: second, b: first };
}
