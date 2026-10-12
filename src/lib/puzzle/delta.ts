import type { PuzzleConnection, PuzzleGroup, PuzzleSnapshot } from "@/lib/puzzle/types";

/**
 * Wat er tussen twee versies van de gedeelde puzzel veranderde. Een client
 * past een delta alleen toe als `fromVersion` zijn eigen versie is; anders
 * vraagt hij de server om een resync. Zo verliest of dupliceert een gemiste
 * of dubbel ontvangen update nooit een groep of verbinding.
 */
export interface PuzzleDelta {
  fromVersion: number;
  version: number;
  /** Groepen die niet meer bestaan (bv. na een fusie). */
  removed: string[];
  /** Nieuwe of gewijzigde groepen, volledig. */
  upserted: PuzzleGroup[];
  /** Nieuwe verbindingen. */
  connections: PuzzleConnection[];
  completedAt: string | null;
}

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export function snapshotDelta(before: PuzzleSnapshot, after: PuzzleSnapshot, fromVersion: number, version: number): PuzzleDelta {
  const previous = new Map(before.groups.map((group) => [group.id, JSON.stringify(group)]));
  const current = new Set(after.groups.map((group) => group.id));
  const known = new Set(before.connections.map((c) => key(c.a, c.b)));
  return {
    fromVersion,
    version,
    removed: before.groups.filter((group) => !current.has(group.id)).map((group) => group.id),
    upserted: after.groups.filter((group) => previous.get(group.id) !== JSON.stringify(group)),
    connections: after.connections.filter((c) => !known.has(key(c.a, c.b))),
    completedAt: after.completedAt,
  };
}

export function applyDelta(snapshot: PuzzleSnapshot, delta: PuzzleDelta): PuzzleSnapshot {
  const removed = new Set(delta.removed);
  const groups = snapshot.groups.filter((group) => !removed.has(group.id));
  for (const group of delta.upserted) {
    const index = groups.findIndex((candidate) => candidate.id === group.id);
    if (index >= 0) groups[index] = group; else groups.push(group);
  }
  const known = new Set(snapshot.connections.map((c) => key(c.a, c.b)));
  const connections = [...snapshot.connections, ...delta.connections.filter((c) => !known.has(key(c.a, c.b)))];
  return { ...snapshot, version: delta.version, groups, connections, completedAt: delta.completedAt };
}

/** Voegt opeenvolgende delta's samen tot één patch; null als ze niet aansluiten. */
export function mergeDeltas(deltas: readonly PuzzleDelta[]): PuzzleDelta | null {
  if (!deltas.length) return null;
  let merged = deltas[0];
  for (const next of deltas.slice(1)) {
    if (next.fromVersion !== merged.version) return null;
    const removed = new Set([...merged.removed, ...next.removed]);
    const upserted = new Map(merged.upserted.map((group) => [group.id, group]));
    for (const id of next.removed) upserted.delete(id);
    for (const group of next.upserted) { upserted.set(group.id, group); removed.delete(group.id); }
    merged = {
      fromVersion: merged.fromVersion,
      version: next.version,
      removed: [...removed],
      upserted: [...upserted.values()],
      connections: [...merged.connections, ...next.connections],
      completedAt: next.completedAt,
    };
  }
  return merged;
}
