import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  BOOST_VELOCITY,
  GAP_HEIGHT,
  MAX_GAP_Y,
  MAX_GAP_STEP,
  MASCOT_HITBOX_HEIGHT,
  MASCOT_HITBOX_WIDTH,
  MIN_GAP_Y,
  OBSTACLE_WIDTH,
  PAIR_SPACING,
  collidesWithObstacle,
  createObstaclePair,
  mascotHitbox,
  obstacleRects,
  passedPair,
  stepPhysics,
} from "@/lib/snelleZendeling/gameplay";
import { maxPlausibleScore, validateReportedScore } from "@/lib/snelleZendeling/validation";
import { applyReviveAnswer, selectReviveOptions } from "@/lib/snelleZendeling/rules";
import { rankScores } from "@/lib/snelleZendeling/ranking";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import { PERSONAL_MASCOTS } from "@/lib/mascots";
import { quickMissionaryMascotSprite } from "@/lib/snelleZendeling/assets";

describe("Snelle Zendeling gameplay", () => {
  it("houdt obstakelbreedte, gaphoogte en paarafstand constant", () => {
    const first = createObstaclePair(1, 500, () => 0.1);
    const second = createObstaclePair(2, first.x + PAIR_SPACING, () => 0.9, first.gapY);
    assert.equal(second.x - first.x, PAIR_SPACING);
    assert.equal(obstacleRects(first).bottom.y - first.gapY, GAP_HEIGHT);
    assert.equal(obstacleRects(second).bottom.y - second.gapY, GAP_HEIGHT);
    assert.ok(OBSTACLE_WIDTH > 0);
  });

  it("varieert alleen gapY binnen veilige grenzen", () => {
    let previous: number | undefined;
    for (const random of [0, 0.2, 0.8, 1]) {
      const pair = createObstaclePair(1, 400, () => random, previous);
      assert.ok(pair.gapY >= MIN_GAP_Y && pair.gapY <= MAX_GAP_Y);
      if (previous !== undefined) assert.ok(Math.abs(pair.gapY - previous) <= MAX_GAP_STEP);
      previous = pair.gapY;
    }
  });

  it("scoort elk paar maar één keer", () => {
    const pair = createObstaclePair(1, 100, () => 0.5);
    assert.equal(passedPair(200, pair, false), true);
    assert.equal(passedPair(200, pair, true), false);
  });

  it("gebruikt een kleinere gelijke hitbox voor elke pose", () => {
    const hitbox = mascotHitbox({ x: 90, y: 200, width: 1254, height: 1254 });
    assert.equal(hitbox.width, MASCOT_HITBOX_WIDTH);
    assert.equal(hitbox.height, MASCOT_HITBOX_HEIGHT);
    assert.ok(hitbox.width < 1254 && hitbox.height < 1254);
  });

  it("heeft glide en boost voor iedere persoonlijke gids", () => {
    const spriteNames = PERSONAL_MASCOTS.flatMap((character) =>
      (["glide", "boost"] as const).map((pose) => quickMissionaryMascotSprite(character, pose))
    );
    assert.equal(new Set(spriteNames).size, PERSONAL_MASCOTS.length * 2);
    for (const sprite of spriteNames) {
      assert.equal(existsSync(path.join(process.cwd(), "public", "games", "snelle-zendeling", sprite)), true, `${sprite} ontbreekt`);
    }
  });

  it("raakt de vaste muur en rots, niet alleen hun alpha-silhouet", () => {
    const pair = createObstaclePair(1, 100, () => 0.5);
    assert.equal(collidesWithObstacle({ x: 105, y: pair.gapY + GAP_HEIGHT + 2 }, pair), true);
    assert.equal(collidesWithObstacle({ x: 105, y: pair.gapY - 40 }, pair), true);
    assert.equal(collidesWithObstacle({ x: 105, y: pair.gapY + 50 }, pair), false);
  });

  it("past een boost als één impuls toe en niet opnieuw per animatieframe", () => {
    const first = stepPhysics(270, BOOST_VELOCITY, 1 / 60);
    const second = stepPhysics(first.y, first.velocity, 1 / 60);
    assert.ok(first.velocity > BOOST_VELOCITY);
    assert.ok(second.velocity > first.velocity);
  });

  it("begrensd server-side scoretempo weigert een willekeurige score", () => {
    const started = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-01T00:00:01.000Z");
    assert.ok(maxPlausibleScore(started, now) < 999999);
    assert.equal(validateReportedScore(started, now, 0, 999999).ok, false);
    assert.equal(validateReportedScore(started, now, 2, 1).ok, false);
  });

  it("maakt precies drie revive-opties en bewaakt één revive", () => {
    const options = selectReviveOptions([
      { id: "good", label: "Goed", isCorrect: true },
      { id: "wrong-1", label: "Fout 1", isCorrect: false },
      { id: "wrong-2", label: "Fout 2", isCorrect: false },
      { id: "wrong-3", label: "Fout 3", isCorrect: false },
    ]);
    assert.equal(options?.length, 3);
    assert.equal(options?.filter((option) => option.isCorrect).length, 1);
    assert.equal(applyReviveAnswer("DEAD_AWAITING_REVIVE", false, true), "REVIVE_READY");
    assert.equal(applyReviveAnswer("DEAD_AWAITING_REVIVE", false, false), "FINISHED");
    assert.equal(applyReviveAnswer("DEAD_AWAITING_REVIVE", true, true), null);
  });

  it("kiest per gebruiker de beste score en breekt gelijke scores deterministisch", () => {
    const early = new Date("2026-01-01T00:00:01Z");
    const late = new Date("2026-01-01T00:00:02Z");
    const ranked = rankScores([
      { userId: "later", score: 10, finishedAt: late },
      { userId: "first", score: 10, finishedAt: early },
      { userId: "later", score: 4, finishedAt: early },
    ]);
    assert.deepEqual(ranked.map((entry) => entry.userId), ["first", "later"]);
  });

  it("staat als uitgeschakeld spel met stabiele route in de catalogus", () => {
    const game = GAME_CATALOG.find((entry) => entry.id === "quick-missionary");
    assert.deepEqual(game && { enabledKey: game.enabledKey, href: game.href }, { enabledKey: "quickMissionaryEnabled", href: "/snelle-zendeling" });
  });
});
