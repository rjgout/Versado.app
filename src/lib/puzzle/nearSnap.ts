import { boardPosition, boardSnapTarget, findSnapConnection, groupFor } from "@/lib/puzzle/engine";
import type { GlowEdge, NearSnapGlow } from "@/lib/puzzle/render";
import { puzzlePolicy, type PuzzleDifficulty, type PuzzleGeometry, type PuzzleSnapshot } from "@/lib/puzzle/types";

// Bijna-passend-feedback tijdens het slepen. Dit bestand beslist niets zelf: de engine blijft de enige autoriteit
// (`findSnapConnection` voor verbindingen, `boardSnapTarget` voor de bordpositie, met de bestaande snapafstand en
// moeilijkheidsregels). Hier wordt alleen gevraagd "zou loslaten hier nu snappen?" en het antwoord vertaald naar
// presentatiestatus. Alles is lokaal; er gaat niets naar een server of andere speler.

/** Korte, rustige overgang bij binnenkomst van de snapzone; verdwijnen gebeurt onmiddellijk. */
export const NEAR_SNAP_FADE_MS = 140;

export interface NearSnapInput {
  snapshot: PuzzleSnapshot;
  geometry: PuzzleGeometry;
  difficulty: PuzzleDifficulty;
  rulesVersion: number;
  /** De groep die de speler zelf sleept. */
  groupId: string;
  /** Weergegeven positie van die groep (Samen: de lokale sleeppositie, die nog niet in de gedeelde stand staat). */
  x: number;
  y: number;
  now: number;
  reducedMotion: boolean;
}

/** Respecteert de systeeminstelling live; de media query wordt één keer gemaakt. */
let reducedMotionQuery: MediaQueryList | null = null;
export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  reducedMotionQuery ??= matchMedia("(prefers-reduced-motion: reduce)"); return reducedMotionQuery.matches;
}

/** Ondiepe kopie met één groep op een andere plek: O(aantal groepen) verwijzingen, geen diepe kloon. */
export function withGroupAt(snapshot: PuzzleSnapshot, groupId: string, x: number, y: number): PuzzleSnapshot {
  return withGroupAtIndex(snapshot, snapshot.groups.findIndex((group) => group.id === groupId), x, y);
}
function withGroupAtIndex(snapshot: PuzzleSnapshot, index: number, x: number, y: number): PuzzleSnapshot {
  const groups = snapshot.groups.slice();
  if (index >= 0) groups[index] = { ...groups[index], x, y };
  return { ...snapshot, groups };
}

/**
 * Houdt de presentatiestatus bij en hergebruikt dezelfde objecten (geen allocaties per pointerbeweging behalve de
 * ondiepe kopie die de engine nodig heeft). Geeft `null` zodra er niets te tonen is; de aanroeper roept dat elk frame aan
 * zolang er gesleept wordt, en `reset()` zodra het slepen stopt.
 */
export function createNearSnapTracker() {
  const edge = (): GlowEdge => ({ piece: 0, neighbour: 0, anchorPiece: 0, x: 0, y: 0 });
  const glow: NearSnapGlow = { edgeCount: 0, edges: [edge(), edge()], slot: { active: false, pieceIds: [], x: 0, y: 0 }, strength: 0 };
  let key = ""; let since = 0; let active = false;
  const reset = () => { key = ""; active = false; glow.edgeCount = 0; glow.slot.active = false; glow.strength = 0; return null; };
  function update(input: NearSnapInput): NearSnapGlow | null {
    const { snapshot, geometry, difficulty, rulesVersion, groupId } = input;
    const index = snapshot.groups.findIndex((candidate) => candidate.id === groupId); const group = snapshot.groups[index];
    if (!group || snapshot.completedAt) return reset();
    const view = group.x === input.x && group.y === input.y ? snapshot : withGroupAtIndex(snapshot, index, input.x, input.y);
    const connection = findSnapConnection(view, geometry, difficulty, groupId, rulesVersion);
    // Eerst een goedkope poort op de afstand, daarna beslist boardSnapTarget (dat ook de structuur valideert) alsnog.
    let slot: { x: number; y: number } | null = null;
    const policy = puzzlePolicy(difficulty, rulesVersion);
    if (policy.boardSnap && !group.anchored && group.rotation === 0) {
      const to = boardPosition(geometry, group);
      if (Math.hypot(input.x - to.x, input.y - to.y) <= policy.boardSnapDistance) slot = boardSnapTarget(view, geometry, difficulty, groupId, rulesVersion);
    }
    if (!connection && !slot) return reset();
    const next = `${connection ? `${connection.a}>${connection.b}` : ""}${slot ? "|bord" : ""}`;
    if (next !== key) { key = next; since = input.now; }
    glow.strength = input.reducedMotion ? 1 : Math.min(1, Math.max(0, (input.now - since) / NEAR_SNAP_FADE_MS));
    // Het stilstaande stuk is `a`, het gesleepte stuk `b` (zie findSnapConnection).
    const fixed = connection ? groupFor(view, connection.a) : undefined;
    if (connection && fixed) {
      const [still, moving] = glow.edges;
      still.piece = connection.a; still.neighbour = connection.b; still.anchorPiece = fixed.pieceIds[0]; still.x = fixed.x; still.y = fixed.y;
      moving.piece = connection.b; moving.neighbour = connection.a; moving.anchorPiece = group.pieceIds[0]; moving.x = input.x; moving.y = input.y;
      glow.edgeCount = 2;
    } else glow.edgeCount = 0;
    glow.slot.active = slot !== null; active = true;
    if (slot) { glow.slot.pieceIds = group.pieceIds; glow.slot.x = slot.x; glow.slot.y = slot.y; }
    return glow;
  }
  // Alleen tijdens de korte overgang is een vervolgframe nodig; daarna staat het beeld stil (geen permanente lus).
  return { update, reset, get animating() { return active && glow.strength < 1; } };
}
export type NearSnapTracker = ReturnType<typeof createNearSnapTracker>;
