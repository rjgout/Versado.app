import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyPuzzleRoute, previousPuzzleStage, JIGSAW_ROUTE } from "../src/lib/puzzle/navigation";
import { PLAY_ROUTE } from "../src/lib/navigation";
import { isFocusRoute } from "../src/lib/focusMode";

const read = (path: string) => readFileSync(path, "utf8");

test("de puzzelroutes hebben een expliciete bestemming, los van geschiedenis", () => {
  assert.deepEqual(classifyPuzzleRoute("/jigsaw"), { kind: "catalog", parent: PLAY_ROUTE });
  assert.deepEqual(classifyPuzzleRoute("/jigsaw/samen/abc123"), { kind: "coop", id: "abc123", parent: JIGSAW_ROUTE });
  assert.deepEqual(classifyPuzzleRoute("/jigsaw/wedstrijd/xyz"), { kind: "match", id: "xyz", parent: JIGSAW_ROUTE });
  assert.deepEqual(classifyPuzzleRoute("/jigsaw/records"), { kind: "records", parent: JIGSAW_ROUTE });
  assert.deepEqual(classifyPuzzleRoute("/jigsaw/records/v1"), { kind: "leaderboard", id: "v1", parent: "/jigsaw/records" });
  for (const other of ["/live", "/jigsaw/samen", "/jigsaw/samen/a/b", "/jigsaw/overig/x", "/word-game"]) assert.equal(classifyPuzzleRoute(other), null, other);
});

test("binnen een wedstrijdpoging gaat de vraag terug naar de voltooide afbeelding, de rest naar het overzicht", () => {
  assert.equal(previousPuzzleStage("QUESTION"), "COMPLETE");
  for (const stage of ["BOARD", "COMPLETE", "RESULT"] as const) assert.equal(previousPuzzleStage(stage), null);
});

test("de terugbalk kent alle puzzelroutes en dwingt de semantische bestemming af", () => {
  const bar = read("src/components/SubpageBackBar.tsx");
  assert.match(bar, /classifyPuzzleRoute\(pathname\)/);
  assert.match(bar, /forceFallback: true/);
  for (const path of ["/jigsaw/samen/x", "/jigsaw/wedstrijd/x"]) assert.equal(isFocusRoute(path), true, path);
});

test("puzzelschermen gebruiken nergens router.back() en zetten het terugdoel op de werkelijke route", () => {
  for (const file of ["src/components/JigsawV2Client.tsx", "src/components/puzzle/CoopClient.tsx", "src/components/puzzle/MatchClient.tsx", "src/components/puzzle/PuzzleBackTarget.tsx", "src/components/puzzle/PuzzleTogetherOverview.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /router\.back\(\)|history\.back\(/, file);
    assert.doesNotMatch(source, /useSetBackTarget\("\/jigsaw"/, `${file}: een vast pad komt nooit overeen met een dynamische route`);
    assert.doesNotMatch(source, /router\.push\("\/jigsaw"\)/, `${file}: terug voegt geen geschiedenisitem toe`);
  }
});

test("MatchClient en de gedeelde werktafel zetten het terugdoel niet allebei tegelijk", () => {
  const match = read("src/components/puzzle/MatchClient.tsx");
  assert.doesNotMatch(match, /useSetBackTarget\(/, "MatchClient gebruikt PuzzleBackTarget in plaats van een eigen override");
  assert.match(match, /<PuzzleBackTarget onBack=\{goBack\} \/>/);
  // De werktafel rendert (en wint) in plaats van het wedstrijdscherm, nooit ernaast.
  assert.match(match, /if \(puzzle && \(playing \|\| questionPending\)[^\n]*\{/);
});
