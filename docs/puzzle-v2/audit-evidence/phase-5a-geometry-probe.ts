// Audit fase 5A: wat de huidige camera- en tafelinstellingen op verschillende schermen opleveren.
// Alleen lezen/rekenen met de bestaande bibliotheek; geen wijziging van de applicatie.
//   npx tsx docs/puzzle-v2/audit-evidence/phase-5a-geometry-probe.ts
import { createPuzzleGeometry } from "../../../src/lib/puzzle/geometry";
import { newPuzzleSnapshot } from "../../../src/lib/puzzle/engine";
import { puzzleWorktable, groupBounds } from "../../../src/lib/puzzle/worktable";
import { initialPuzzleCamera, fitCamera } from "../../../src/lib/puzzle/viewport";

// Beschikbare canvasruimte = scherm minus gemeten balken (indicatief: kop ≈ 56 + terugbalk ≈ 52 px; onderbalk valt weg in focusmodus).
const screens = [["iPhone SE 320x568", 320, 568], ["Android 360x740", 360, 740], ["iPhone 390x844", 390, 844], ["landscape 740x360", 740, 360], ["tablet 768x1024", 768, 1024]] as const;
const rows: unknown[] = [];
for (const [label, width, height] of screens) {
  const view = { width, height: Math.max(200, height - 108) };
  for (const pieces of [24, 96, 150, 300] as const) {
    const geometry = createPuzzleGeometry(pieces, "audit-seed", 2);
    const snapshot = newPuzzleSnapshot(geometry, "ADVENTURER");
    const table = puzzleWorktable(geometry);
    const start = initialPuzzleCamera(view, geometry, snapshot);
    const fit = fitCamera(view, table.bounds);
    const visible = snapshot.groups.filter((g) => { const b = groupBounds(geometry, g); const x0 = start.x + b.minX * start.scale, x1 = start.x + b.maxX * start.scale, y0 = start.y + b.minY * start.scale, y1 = start.y + b.maxY * start.scale; return x1 > 0 && x0 < view.width && y1 > 0 && y0 < view.height; }).length;
    rows.push({ screen: label, pieces, startPxPerPiece: Math.round(start.scale), startVisiblePieces: visible, fitPxPerPiece: +fit.scale.toFixed(1), tableUnits: `${(table.bounds.maxX - table.bounds.minX).toFixed(1)}x${(table.bounds.maxY - table.bounds.minY).toFixed(1)}` });
  }
}
console.table(rows);
