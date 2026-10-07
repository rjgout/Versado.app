import type { ParticipantState } from "./matchRules";

/**
 * De weergave van de andere spelers (ghosts) tijdens een gezamenlijke run, puur
 * en zonder browser. Eén ghost per deelnemer blijft de hele wedstrijd bestaan;
 * de toestand bepaalt alleen hoe hij getoond wordt, nooit of hij bestaat. Zo
 * ontstaat bij ACTIVE -> REVIVE_PENDING -> ACTIVE geen verdwijnen/opnieuw
 * toevoegen, geen sprong naar een oude positie en geen flits.
 *
 * - Wie niet (meer) vliegt vervaagt rustig op zijn laatst geldige positie.
 * - Na terugkeer (Genees) of herverbinden telt alleen de eerste nieuwe momentopname
 *   als startpositie: er wordt nooit geïnterpoleerd vanaf een oude of verre
 *   positie (snap), daarna beweegt de ghost weer vloeiend.
 * - Een momentopname met een lager `life`-nummer (van vóór de laatste dood) of voor
 *   een deelnemer die niet vliegt, wordt genegeerd: een laat positie-event draait
 *   een nieuwere toestand nooit terug.
 */

/** Verder dan dit (px) is geen beweging maar een nieuwe positie: snap in plaats van doorschuiven. */
export const GHOST_MAX_JUMP = 220;
/** Zonder nieuwe momentopname binnen deze tijd telt een ghost als verouderd en vervaagt hij. */
export const GHOST_STALE_MS = 1_500;
const SMOOTHING_PER_SECOND = 18;
const FADE_IN_PER_SECOND = 4;
const FADE_OUT_PER_SECOND = 2.5;

export interface GhostPose {
  y: number;
  targetY: number;
  boost: boolean;
  /** Hoeveel keer deze speler de wereld (opnieuw) betrad; lager = oud. */
  life: number;
  seenAt: number;
  /** 0 = onzichtbaar, 1 = volledig; de weergave schaalt dit met de gewenste ghost-dekking. */
  alpha: number;
  /** De volgende momentopname is een (her)start en wordt direct overgenomen. */
  awaitingSnapshot: boolean;
  state: ParticipantState;
}

export function newGhost(state: ParticipantState): GhostPose {
  return { y: 0, targetY: 0, boost: false, life: 0, seenAt: Number.NEGATIVE_INFINITY, alpha: 0, awaitingSnapshot: true, state };
}

/** Een toestandswijziging: wie niet vliegt wacht bij terugkeer op een verse startpositie; positie en identiteit blijven. */
export function applyGhostState(ghost: GhostPose, state: ParticipantState): GhostPose {
  if (ghost.state === state) return ghost;
  return { ...ghost, state, awaitingSnapshot: state === "ACTIVE" ? ghost.awaitingSnapshot : true };
}

export interface GhostSnapshot {
  y: number;
  boost: boolean;
  life: number;
}

export function applyGhostSnapshot(ghost: GhostPose, snapshot: GhostSnapshot, now: number): GhostPose {
  if (ghost.state !== "ACTIVE") return ghost;
  if (snapshot.life < ghost.life) return ghost;
  if (!Number.isFinite(snapshot.y)) return ghost;
  const restart = ghost.awaitingSnapshot || snapshot.life > ghost.life || Math.abs(snapshot.y - ghost.y) > GHOST_MAX_JUMP;
  return restart
    ? { ...ghost, y: snapshot.y, targetY: snapshot.y, boost: snapshot.boost, life: snapshot.life, seenAt: now, awaitingSnapshot: false }
    : { ...ghost, targetY: snapshot.y, boost: snapshot.boost, seenAt: now };
}

/** Eén frame: glad naar de doelpositie en in- of uitfaden, nooit springen. */
export function stepGhost(ghost: GhostPose, dtSeconds: number, now: number): GhostPose {
  const dt = Math.max(0, Math.min(dtSeconds, 0.1));
  const visible = ghost.state === "ACTIVE" && !ghost.awaitingSnapshot && now - ghost.seenAt <= GHOST_STALE_MS;
  const rate = visible ? FADE_IN_PER_SECOND : FADE_OUT_PER_SECOND;
  const alpha = visible ? Math.min(1, ghost.alpha + rate * dt) : Math.max(0, ghost.alpha - rate * dt);
  const k = 1 - Math.exp(-SMOOTHING_PER_SECOND * dt);
  const y = ghost.y + (ghost.targetY - ghost.y) * k;
  return alpha === ghost.alpha && y === ghost.y ? ghost : { ...ghost, y, alpha };
}

/** ELIMINATED en FINISHED zijn definitief: een oud bericht maakt nooit iemand weer actief. */
export function isTerminalState(state: ParticipantState): boolean {
  return state === "ELIMINATED" || state === "FINISHED";
}

export function mergeParticipantState(previous: ParticipantState | undefined, next: ParticipantState): ParticipantState {
  return previous && isTerminalState(previous) ? previous : next;
}

/**
 * De andere spelers voor de compacte weergave: stabiele volgorde (zoals de server
 * ze stuurt), zonder wie definitief af is. Wisselen tussen ACTIVE en REVIVE_PENDING
 * verandert niets aan volgorde of aanwezigheid, dus niets springt.
 */
export function remainingOthers<T extends { userId: string; state: ParticipantState }>(participants: T[], myUserId: string): T[] {
  return participants.filter((p) => p.userId !== myUserId && !isTerminalState(p.state));
}

export type RunViewMode = "play" | "spectate" | "result";

/**
 * Wat een deelnemer te zien krijgt. Spectator is geen nieuwe spelstatus: de
 * server houdt ELIMINATED; dit is alleen de weergave van een definitief afgevallen
 * deelnemer zolang de gezamenlijke run nog loopt. Na afsluiting (ook van een
 * eerder uitgeschakelde speler) volgt altijd de uitslag, bij herladen en
 * herverbinden evengoed: de modus volgt uitsluitend uit de server-stand.
 */
export function viewModeFor(state: ParticipantState | undefined, matchStatus: "RUNNING" | "ENDED"): RunViewMode {
  if (matchStatus === "ENDED") return "result";
  return state && isTerminalState(state) ? "spectate" : "play";
}
