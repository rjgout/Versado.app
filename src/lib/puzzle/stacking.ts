import type { PuzzleGroup } from "@/lib/puzzle/types";

// Lokale stapelvolgorde van de puzzeltafel: welke groep ligt boven welke. Alleen presentatie en hit-testing van deze
// speler; de canonieke posities (snapshot) bevatten geen volgorde en veranderen er niet door. De volgorde die hier
// bijgehouden wordt is dezelfde voor tekenen en aanwijzen, zodat je altijd het stuk pakt dat je ziet.

const MAX_RAISED = 64;

export interface Stacking {
  /** Brengt een groep (en dus al haar stukken) naar voren; de laatste is de bovenste. */
  raise(groupId: string): void;
  /** Groepen in tekenvolgorde (onderste eerst). `dragged` ligt tijdelijk boven alles, ook boven de opgetilde groepen. */
  order(groups: readonly PuzzleGroup[], dragged?: string | null): readonly PuzzleGroup[];
  /** Hit-test volgorde: bovenste eerst. Exact het omgekeerde van `order`. */
  hitOrder(groups: readonly PuzzleGroup[], dragged?: string | null): readonly PuzzleGroup[];
  /** Vergeet groepen die niet meer bestaan (na een fusie). */
  prune(groups: readonly PuzzleGroup[]): void;
  readonly raised: readonly string[];
  clear(): void;
}

export function createStacking(): Stacking {
  let stack: string[] = [];
  const order = (groups: readonly PuzzleGroup[], dragged: string | null = null): readonly PuzzleGroup[] => {
    if (!stack.length && !dragged) return groups;
    const byId = new Map(groups.map((group) => [group.id, group] as const));
    const top: PuzzleGroup[] = []; const seen = new Set<string>();
    for (const id of stack) { const group = byId.get(id); if (group && id !== dragged) { top.push(group); seen.add(id); } }
    const rest = groups.filter((group) => !seen.has(group.id) && group.id !== dragged);
    const lifted = dragged ? byId.get(dragged) : undefined;
    return lifted ? [...rest, ...top, lifted] : [...rest, ...top];
  };
  return {
    raise(groupId) { stack = stack.filter((id) => id !== groupId); stack.push(groupId); if (stack.length > MAX_RAISED) stack = stack.slice(-MAX_RAISED); },
    order,
    hitOrder(groups, dragged = null) { return [...order(groups, dragged)].reverse(); },
    prune(groups) { if (!stack.length) return; const alive = new Set(groups.map((group) => group.id)); const next = stack.filter((id) => alive.has(id)); if (next.length !== stack.length) stack = next; },
    get raised() { return stack; },
    clear() { stack = []; },
  };
}
