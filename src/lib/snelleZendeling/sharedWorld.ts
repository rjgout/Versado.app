import {
  FIRST_OBSTACLE_X,
  MASCOT_X,
  OBSTACLE_WIDTH,
  PAIR_SPACING,
  WORLD_WIDTH,
  effectiveGapHeight,
  nextGapY,
  worldSpeed,
  type ObstaclePair,
} from "./gameplay";
import { MAX_RUN_SCORE } from "./validation";

/**
 * De gedeelde wereld van een gezamenlijke run (Samen spelen). Alle deelnemers
 * spelen exact dezelfde obstakels op exact dezelfde tijdlijn:
 *
 * - De obstakels volgen deterministisch uit een seed die de server bij de start
 *   vastlegt (geen Math.random, geen lokale volgorde van gebeurtenissen).
 * - De wereld loopt op een gezamenlijke tijdlijn vanaf een servertijdstip; waar
 *   de wereld op tijd t is (afstand, snelheid, moeilijkheid) is een pure functie
 *   van t en de seed, dus latency, een herverbinding of het verschil tussen
 *   toestellen verandert niets aan de wereld, alleen aan wie wanneer instuurt.
 * - Anders dan solo hangt de moeilijkheid niet van de eigen score af (spelers
 *   hebben verschillende scores en wie Geneest, vliegt verder in dezelfde
 *   wereld) maar van de voortgang van die wereld: het aantal paren dat de
 *   gezamenlijke tijdlijn gepasseerd is. Voor wie niet crasht is dat precies
 *   zijn score, dus de curve in difficulty.ts blijft gelijk.
 *
 * Puur, zonder database of browser: client en server delen dit bestand.
 */

/** Zoals solo bij benadering: een paar ontstaat als de score ongeveer twee paren achterloopt. */
export const SHARED_SPAWN_LEAD = 2;
/** Tijd tussen "gestart" en het begin van de tijdlijn, voor het aftellen. */
export const MATCH_COUNTDOWN_MS = 3500;
/** Marge op klokverschil en latency bij het controleren van een gemelde score. */
export const SHARED_SCORE_GRACE_SECONDS = 2.5;

export function pairDifficultyScore(pairId: number): number {
  return Math.max(0, pairId - SHARED_SPAWN_LEAD);
}

/** Positie van paar `pairId` (1-gebaseerd) op afstand 0 van de tijdlijn. */
export function pairWorldX(pairId: number): number {
  return FIRST_OBSTACLE_X + (pairId - 1) * PAIR_SPACING;
}

const FIRST_PASS_DISTANCE = FIRST_OBSTACLE_X + OBSTACLE_WIDTH - MASCOT_X;

/** Afstand waarboven paar `pairId` gepasseerd is (zelfde regel als passedPair in gameplay.ts). */
export function passDistance(pairId: number): number {
  return FIRST_PASS_DISTANCE + (pairId - 1) * PAIR_SPACING;
}

// T[k] = seconden op de tijdlijn waarop paar k gepasseerd wordt. Tussen het
// passeren van paar k-1 en k vliegt de wereld met de snelheid die bij k-1
// gepasseerde paren hoort (difficulty.ts).
const MAX_PAIRS = MAX_RUN_SCORE + 1;
const PASS_TIME: Float64Array = (() => {
  const table = new Float64Array(MAX_PAIRS + 1);
  table[1] = FIRST_PASS_DISTANCE / worldSpeed(0);
  for (let k = 2; k <= MAX_PAIRS; k++) table[k] = table[k - 1] + PAIR_SPACING / worldSpeed(k - 1);
  return table;
})();

/** Seconden op de tijdlijn waarop paar `pairId` gepasseerd wordt. */
export function passTimeSeconds(pairId: number): number {
  return PASS_TIME[Math.max(1, Math.min(MAX_PAIRS, Math.floor(pairId)))];
}

/** Hoe ver de wereld is gescrold, `seconds` na het begin van de tijdlijn. */
export function distanceAt(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  if (seconds <= PASS_TIME[1]) return worldSpeed(0) * seconds;
  let low = 1;
  let high = MAX_PAIRS;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (PASS_TIME[mid] <= seconds) low = mid;
    else high = mid - 1;
  }
  return passDistance(low) + worldSpeed(low) * (seconds - PASS_TIME[low]);
}

/** Aantal paren dat de tijdlijn op deze afstand gepasseerd is. */
export function passedPairsAtDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance <= FIRST_PASS_DISTANCE) return 0;
  return Math.min(MAX_RUN_SCORE, Math.ceil((distance - FIRST_PASS_DISTANCE) / PAIR_SPACING));
}

/** De voortgang van de wereld (= de score van iemand die nooit crasht) na `seconds`. */
export function sharedProgressAt(seconds: number): number {
  return passedPairsAtDistance(distanceAt(seconds));
}

/** Maximale score die op servertijd geldig is; met marge voor latency en klokverschil. */
export function maxSharedScore(startsAt: Date, now: Date, graceSeconds = SHARED_SCORE_GRACE_SECONDS): number {
  return sharedProgressAt((now.getTime() - startsAt.getTime()) / 1000 + graceSeconds);
}

export function validateSharedScore(startsAt: Date, now: Date, previousScore: number, reportedScore: number): { ok: true; score: number } | { ok: false; reason: string } {
  if (!Number.isInteger(reportedScore) || reportedScore < 0 || reportedScore > MAX_RUN_SCORE) return { ok: false, reason: "INVALID_SCORE" };
  if (reportedScore < previousScore) return { ok: false, reason: "SCORE_DECREASED" };
  if (reportedScore > maxSharedScore(startsAt, now)) return { ok: false, reason: "SCORE_TOO_FAST" };
  return { ok: true, score: reportedScore };
}

// --- Deterministische generator -------------------------------------------------

/** xmur3: een string naar een 32-bit getal; stabiel over browsers en Node. */
export function hashSeed(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32: kleine seedbare generator, volledig met 32-bit-gehele-getalrekenkunde. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SharedWorld {
  readonly seed: string;
  /** Paar `pairId` (1-gebaseerd) op afstand 0: x = pairWorldX(pairId). Altijd dezelfde uitkomst voor dezelfde seed. */
  pair(pairId: number): ObstaclePair;
  /** De zichtbare paren bij deze afstand, met x ten opzichte van het scherm. */
  visiblePairs(distance: number): ObstaclePair[];
}

export function createSharedWorld(seed: string): SharedWorld {
  const cache: ObstaclePair[] = [];
  const pair = (pairId: number): ObstaclePair => {
    if (!Number.isInteger(pairId) || pairId < 1 || pairId > MAX_PAIRS) throw new RangeError("Ongeldig paarnummer.");
    while (cache.length < pairId) {
      const id = cache.length + 1;
      // Elk paar heeft een eigen generator uit (seed, id): de volgorde waarin paren
      // worden opgevraagd verandert dus nooit hun uitkomst. Alleen de stap van gapY
      // hangt van het vorige paar af, zoals solo.
      const random = mulberry32(hashSeed(`${seed}:${id}`));
      const gapHeight = effectiveGapHeight(pairDifficultyScore(id));
      cache.push({ id, x: pairWorldX(id), gapY: nextGapY(random, cache[id - 2]?.gapY, gapHeight), gapHeight });
    }
    return cache[pairId - 1];
  };
  return {
    seed,
    pair,
    visiblePairs(distance: number): ObstaclePair[] {
      const first = Math.max(1, Math.floor((distance - FIRST_OBSTACLE_X - OBSTACLE_WIDTH - 2) / PAIR_SPACING) + 1);
      const result: ObstaclePair[] = [];
      for (let id = first; id <= MAX_PAIRS; id++) {
        const x = pairWorldX(id) - distance;
        if (x > WORLD_WIDTH) break;
        if (x + OBSTACLE_WIDTH < -2) continue;
        const base = pair(id);
        result.push({ ...base, x });
      }
      return result;
    },
  };
}
