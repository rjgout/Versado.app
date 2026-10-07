import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Samen-scores mogen nooit in de Solo-ranking of in persoonlijke solo-records
// terechtkomen. Dit is de structurele bewaking: elke plek die QuickMissionaryRun
// op een manier leest die kan uitmonden in een score-ranglijst, moet de ene
// solo-definitie (SOLO_RUNS, soloScope.ts) gebruiken. De gedragstests staan in
// tests/snelle-zendeling-match.integration.test.ts.

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "generated") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const root = process.cwd();
const sources = walk(path.join(root, "src")).map((file) => ({ file: path.relative(root, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));

// Bestanden die runs per id of per wedstrijd lezen/schrijven (levenscyclus, geen ranglijst).
const LIFECYCLE_ONLY = new Set(["src/lib/snelleZendeling/match.ts", "src/server/quickMissionary.ts"]);

test("elke lezing van QuickMissionaryRun voor scores/ranglijsten gebruikt de solo-definitie", () => {
  const offenders: string[] = [];
  for (const { file, text } of sources) {
    if (LIFECYCLE_ONLY.has(file)) continue;
    // findMany/findFirst/count/aggregate/groupBy kunnen een ranglijst of record opleveren.
    for (const match of text.matchAll(/quickMissionaryRun\.(findMany|findFirst|count|aggregate|groupBy)\(([\s\S]{0,260}?)\)\s*[,;)\]]/g)) {
      const usesSolo = match[2].includes("SOLO_RUNS");
      const lifecycle = /where:\s*\{\s*(id|userId_|matchId)/.test(match[2]);
      if (!usesSolo && !lifecycle) offenders.push(`${file}: ${match[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("de solo-ranking en de persoonlijke records lezen via SOLO_RUNS", () => {
  const runs = readFileSync(path.join(root, "src/lib/snelleZendeling/runs.ts"), "utf8");
  assert.equal(runs.match(/SOLO_RUNS/g)?.length, 4, "import + dagrecord + all-timerecord + ranglijst");
  assert.equal(/matchId:\s*null/.test(runs), false, "geen losse variant van de solo-definitie");
});

test("niets buiten de solo-definitie schrijft een apart solo-record: scores leven alleen op de run", () => {
  const writers = sources.filter(({ text }) => /quickMissionaryRun\.(create|createMany|update|updateMany|upsert)\(/.test(text)).map(({ file }) => file).sort();
  assert.deepEqual(writers, ["src/lib/snelleZendeling/match.ts", "src/lib/snelleZendeling/runs.ts"]);
  // Er is geen aparte highscore-tabel of -kolom die door een wedstrijd gevuld kan worden.
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  const model = schema.slice(schema.indexOf("model QuickMissionaryRun {"), schema.indexOf("enum QuickMissionaryMatchStatus"));
  assert.equal(/highScore|bestScore/i.test(model), false);
});
