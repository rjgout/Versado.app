import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { PLAY_ROUTE, QUICK_MISSIONARY_RANKING_HREF } from "../src/lib/navigation";
import { shouldUseFallback } from "../src/lib/navigationHistory";

const root = process.cwd();

test("de leaderboard heeft Spelen als expliciete semantische parent", () => {
  assert.equal(PLAY_ROUTE, "/live");
  assert.equal(QUICK_MISSIONARY_RANKING_HREF, "/snelle-zendeling?view=leaderboard#quick-missionary-leaderboard");
  assert.equal(shouldUseFallback(true, true), true);
  assert.equal(shouldUseFallback(true, false), false);
  assert.equal(shouldUseFallback(false, false), true);

  const backBar = readFileSync(path.join(root, "src/components/SubpageBackBar.tsx"), "utf8");
  assert.match(backBar, /profileView === "leaderboard"/);
  assert.match(backBar, /forceFallback: isLeaderboard/);
});

test("een beëindigde run blijft niet in de back-stack achter de ranking", () => {
  const start = readFileSync(path.join(root, "src/components/snelleZendeling/StartClient.tsx"), "utf8");
  const run = readFileSync(path.join(root, "src/components/snelleZendeling/RunClient.tsx"), "utf8");

  assert.match(start, /router\.replace\(`\/snelle-zendeling\/run\/\$\{data\.runId\}`\)/);
  assert.match(start, /QUICK_MISSIONARY_RANKING_HREF/);
  assert.match(start, /replace className=\{secondaryButton\}/);
  assert.match(run, /router\.replace\(QUICK_MISSIONARY_RANKING_HREF\)/);
  assert.match(run, /router\.replace\(`\/snelle-zendeling\/run\/\$\{data\.runId\}`\)/);
  assert.match(run, /<Link replace className="btn-secondary w-full" href=\{PLAY_ROUTE\}/);
});
