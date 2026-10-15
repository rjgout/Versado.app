// Fase 5D-2: rekentijd van de bewegingslaag per getekend beeld (node, desktop-CPU). npx tsx docs/puzzle-v2/audit-evidence/phase-5d2-bench.ts
import { createPuzzleGeometry } from "../../../src/lib/puzzle/geometry";
import { connectGroups, groupFor, moveGroup, newPuzzleSnapshot } from "../../../src/lib/puzzle/engine";
import { createPuzzleMotion, type RemoteEntry } from "../../../src/lib/puzzle/motion";
const rows: Array<Record<string, string | number>> = [];
for (const count of [96, 150, 300] as const) {
  const geometry = createPuzzleGeometry(count, "bench", 2); const base = newPuzzleSnapshot(geometry, "ADVENTURER");
  const before = moveGroup(moveGroup(base, geometry, "p0", 5, 5), geometry, "p1", 6.2, 5); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1);
  const none = new Map<string, RemoteEntry>(); const remote = new Map<string, RemoteEntry>([["p7", { x: 9, y: 9, until: Number.MAX_SAFE_INTEGER }], ["p8", { x: 3, y: 8, until: Number.MAX_SAFE_INTEGER }]]);
  const n = 20000; const time = (fn: () => void) => { for (let i = 0; i < 500; i++) fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t) / n * 1000; };
  const idle = createPuzzleMotion(geometry); let now = 0; idle.update({ snapshot: after, remote: none, now, wall: now, enabled: true, maxDistance: .46 });
  const idleUpdate = time(() => { now += 16; idle.update({ snapshot: after, remote: none, now, wall: now, enabled: true, maxDistance: .46 }); idle.groups(after.groups, now); idle.active(now); });
  const follow = createPuzzleMotion(geometry); follow.update({ snapshot: after, remote, now: 0, wall: 0, enabled: true, maxDistance: .46 }); let t2 = 0; const spot = { x: 0, y: 0 };
  const remoteFrame = time(() => { t2 += 16; follow.update({ snapshot: after, remote, now: t2, wall: t2, enabled: true, maxDistance: .46 }); follow.groups(after.groups, t2); follow.remoteAt("p7", t2, spot); follow.remoteAt("p8", t2, spot); follow.active(t2); });
  const glide = () => { const motion = createPuzzleMotion(geometry); motion.update({ snapshot: before, remote: none, now: 0, wall: 0, enabled: true, maxDistance: .46 }); motion.update({ snapshot: after, remote: none, now: 10, wall: 10, enabled: true, maxDistance: .46 }); return motion; };
  const start = time(() => { glide(); }); const during = glide(); const groups = time(() => { during.groups(after.groups, 80); });
  rows.push({ stukken: count, "rust µs/beeld": +idleUpdate.toFixed(2), "twee remote slepers µs/beeld": +remoteFrame.toFixed(2), "snap starten µs (eenmalig)": +start.toFixed(1), "groepenlijst tijdens glijden µs/beeld": +groups.toFixed(1) });
}
void groupFor; console.table(rows); console.log(JSON.stringify(rows));
