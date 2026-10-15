// Meting van de ruimte-maak-berekening (planSettle) tegen het bestaande snap-zoekwerk, per puzzelgrootte.
// npx tsx scripts/puzzle/perf-settle.ts
import { createPuzzleGeometry } from "../../src/lib/puzzle/geometry";
import { findSnapConnection, newPuzzleSnapshot } from "../../src/lib/puzzle/engine";
import { overlappingGroups, planSettle } from "../../src/lib/puzzle/collision";
import { puzzleWorktable } from "../../src/lib/puzzle/worktable";
import type { PuzzlePieceCount, PuzzleSnapshot } from "../../src/lib/puzzle/types";

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function time(run: () => unknown, rounds = 21) { const samples: number[] = []; for (let i = 0; i < rounds; i++) { const start = performance.now(); run(); samples.push(performance.now() - start); } return median(samples); }

console.log("stukken | planSettle mediaan | planSettle p. groep zwaarste | snapzoek mediaan | verplaatst | overlap na");
for (const count of [24, 96, 150, 300] as PuzzlePieceCount[]) {
  const geometry = createPuzzleGeometry(count, "perf", 2);
  const table = puzzleWorktable(geometry);
  // Slechtste geval: alle losse stukken opgehoopt in een klein gebied rond het bordmidden.
  const snapshot: PuzzleSnapshot = newPuzzleSnapshot(geometry, "ADVENTURER");
  const cx = table.puzzle.x + table.puzzle.width / 2, cy = table.puzzle.y + table.puzzle.height / 2;
  const cluster = Math.ceil(Math.sqrt(snapshot.groups.length));
  snapshot.groups.forEach((group, index) => { group.x = cx + (index % cluster) * .25 - cluster * .125; group.y = cy + Math.floor(index / cluster) * .25 - cluster * .125; group.rotation = 0; });
  const focus = snapshot.groups[Math.floor(snapshot.groups.length / 2)].id;
  const ms = time(() => planSettle(snapshot, geometry, { focusGroupId: focus, difficulty: "ADVENTURER", rulesVersion: 2 }));
  const plan = planSettle(snapshot, geometry, { focusGroupId: focus, difficulty: "ADVENTURER", rulesVersion: 2 });
  const spaced = { ...snapshot, groups: snapshot.groups.map((group) => { const move = plan.moves.find((m) => m.groupId === group.id); return move ? { ...group, x: move.x, y: move.y } : group; }) };
  // Ruim bezet bord (normale situatie): stukken staan op hun startplek en één groep wordt neergelegd.
  const normal = newPuzzleSnapshot(geometry, "ADVENTURER");
  const normalMs = time(() => planSettle(normal, geometry, { focusGroupId: normal.groups[0].id, difficulty: "ADVENTURER", rulesVersion: 2 }));
  const snapMs = time(() => findSnapConnection(normal, geometry, "ADVENTURER", normal.groups[0].id, 2));
  console.log(`${String(count).padStart(7)} | ${ms.toFixed(2).padStart(8)} ms (opgehoopt) / ${normalMs.toFixed(2)} ms (normaal) | ${(ms / Math.max(1, plan.moves.length)).toFixed(3)} ms | ${snapMs.toFixed(3)} ms | ${plan.moves.length} | ${overlappingGroups(spaced, geometry, focus).length}`);
}
