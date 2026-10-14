// Fase 5D-1: rekentijd van één bijna-passend-evaluatie (de engine-aanroepen + presentatiestatus) per pointerbeweging.
//   npx tsx docs/puzzle-v2/audit-evidence/phase-5d1-bench.ts
import { createPuzzleGeometry } from "../../../src/lib/puzzle/geometry";
import { connectGroups, findSnapConnection, groupFor, moveGroup, newPuzzleSnapshot } from "../../../src/lib/puzzle/engine";
import { createNearSnapTracker } from "../../../src/lib/puzzle/nearSnap";
const rows: Array<Record<string, string | number>> = [];
for (const [count, groupSize] of [[96, 1], [150, 1], [300, 1], [300, 25], [300, 100], [300, 200]] as const) {
  const geometry = createPuzzleGeometry(count, "bench", 2); let snapshot = newPuzzleSnapshot(geometry, "ADVENTURER"); const columns = geometry.grid.columns;
  // Eerst alle stukken van de groep exact op hun canonieke plek tot één groep verbinden (rij voor rij).
  for (let id = 1; id < groupSize; id++) {
    const origin = groupFor(snapshot, 0)!; const piece = geometry.pieces[id];
    snapshot = moveGroup(snapshot, geometry, `p${id}`, origin.x + piece.column, origin.y + piece.row);
    const neighbour = piece.column > 0 ? id - 1 : id - columns; snapshot = connectGroups(snapshot, geometry, "ADVENTURER", neighbour, id);
  }
  const moving = groupFor(snapshot, groupSize - 1)!; const tracker = createNearSnapTracker(); let now = 0; let hit = 0;
  const run = () => { const x = moving.x + 7 + (now % 7) * .13; const y = moving.y + 4; now += 16; if (tracker.update({ snapshot, geometry, difficulty: "ADVENTURER", rulesVersion: 2, groupId: moving.id, x, y, now, reducedMotion: false })) hit++; };
  const engine = () => findSnapConnection(snapshot, geometry, "ADVENTURER", moving.id, 2);
  for (let i = 0; i < 300; i++) { run(); engine(); }
  const n = 3000; let t = performance.now(); for (let i = 0; i < n; i++) run(); const feedback = (performance.now() - t) / n * 1000;
  t = performance.now(); for (let i = 0; i < n; i++) engine(); const engineOnly = (performance.now() - t) / n * 1000;
  rows.push({ stukken: count, groepsgrootte: groupSize, groepen: snapshot.groups.length, "feedback µs": +feedback.toFixed(1), "alleen findSnapConnection µs": +engineOnly.toFixed(1), treffers: hit });
}
console.table(rows); console.log(JSON.stringify(rows));
