// Meting van de ruimte-maak-berekening (planSettle) tegen het bestaande snap-zoekwerk, per puzzelgrootte.
// npx tsx scripts/puzzle/perf-settle.ts
import { createPuzzleGeometry } from "../../src/lib/puzzle/geometry";
import { boardPosition, connectGroups, findSnapConnection, groupFor, moveGroup, newPuzzleSnapshot } from "../../src/lib/puzzle/engine";
import { overlappingGroups, pieceCoreRects, planSettle } from "../../src/lib/puzzle/collision";
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

// Groot verbonden blok (de helft van de stukken, ruim tientallen leden) met één los stuk dat alleen het laatste stuk raakt.
console.log("\nstukken | groot verbonden blok: planSettle mediaan | stukken in het blok | gevonden botsing");
for (const count of [24, 96, 150, 300] as PuzzlePieceCount[]) {
  const geometry = createPuzzleGeometry(count, "perf", 2);
  let snapshot = newPuzzleSnapshot(geometry, "DISCOVERER");
  const members = geometry.pieces.slice(0, Math.floor(count / 2));
  for (const piece of members) { const to = boardPosition(geometry, { id: `p${piece.id}`, pieceIds: [piece.id], x: 0, y: 0, rotation: 0 }); snapshot = moveGroup(snapshot, geometry, `p${piece.id}`, to.x + 12, to.y); }
  for (const piece of members) for (const other of [piece.id - 1, piece.id - geometry.grid.columns]) if (other >= 0 && members.some((m) => m.id === other) && geometry.pieces[other].row === piece.row + (other === piece.id - 1 ? 0 : -1)) snapshot = connectGroups(snapshot, geometry, "DISCOVERER", other, piece.id);
  const block = groupFor(snapshot, members[0].id)!; const outsider = geometry.pieces[count - 1];
  const lastRect = pieceCoreRects(geometry, block).at(-1)!;
  snapshot = moveGroup(snapshot, geometry, `p${outsider.id}`, lastRect.minX + block.x + .4, lastRect.minY + block.y + .3);
  const options = { focusGroupId: block.id, difficulty: "DISCOVERER" as const, rulesVersion: 2 };
  const ms = time(() => planSettle(snapshot, geometry, options));
  console.log(`${String(count).padStart(7)} | ${ms.toFixed(2).padStart(8)} ms | ${block.pieceIds.length} | ${overlappingGroups(snapshot, geometry, block.id).length ? "ja" : "nee"}`);
}
