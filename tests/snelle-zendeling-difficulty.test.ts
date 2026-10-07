// Difficulty-curve van Vliegende Versado (difficulty.ts): exacte targets,
// interpolatie, gapY-grenzen bij een kleinere opening, servervalidatie en de
// invarianten die deze opdracht niet mag raken.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DIFFICULTY_POINTS, MAX_DIFFICULTY_SCORE, MAX_SPEED_MULTIPLIER, MIN_GAP_MULTIPLIER, getDifficulty,
} from "@/lib/snelleZendeling/difficulty";
import {
  BOOST_VELOCITY, FIRST_OBSTACLE_X, GAP_HEIGHT, GRAVITY, HORIZONTAL_SPEED, MASCOT_HITBOX_HEIGHT, MASCOT_HITBOX_OFFSET_X,
  MASCOT_HITBOX_OFFSET_Y, MASCOT_HITBOX_WIDTH, MASCOT_RENDER_SIZE, MASCOT_X, MAX_FALL_SPEED, MAX_GAP_STEP, MIN_GAP_Y, OBSTACLE_WIDTH,
  PAIR_SPACING, PLAY_BOTTOM, PLAY_TOP, createObstaclePair, createPairSequence, effectiveGapHeight, gapYBounds,
  mascotHitbox, obstacleRects, passedPair, worldSpeed,
} from "@/lib/snelleZendeling/gameplay";
import {
  LONG_OBSTACLE_SOURCE_HEIGHT, obstacleDisplayScale, rockCoversWorldTop, rockRenderRect, wallCoversWorldBottom, wallRenderRect,
} from "@/lib/snelleZendeling/obstacles";
import { MAX_RUN_SCORE, maxPlausibleScore, minSecondsToReachScore, validateReportedScore } from "@/lib/snelleZendeling/validation";
import { parseDebugDifficultyScore } from "@/components/snelleZendeling/difficultyDebug";

const EPS = 1e-12;
const close = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < EPS, `${message ?? ""} ${actual} ≠ ${expected}`);
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

/** Kleine deterministische generator, zodat de gapY-tests reproduceerbaar zijn. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const SCORES = [0, 100, 300, 500, 700, 1000];

describe("Difficulty-curve: targets", () => {
  const targets: [number, number, number][] = [
    [0, 1.0, 1.0], [50, 0.96, 1.005], [100, 0.92, 1.01], [200, 0.88, 1.015], [300, 0.84, 1.02], [400, 0.81, 1.025],
    [500, 0.78, 1.03], [600, 0.76, 1.035], [700, 0.74, 1.04], [800, 0.72, 1.045], [1000, 0.7, 1.05],
  ];

  it("geeft op ieder targetpunt exact de opgegeven opening en snelheid", () => {
    for (const [score, gap, speed] of targets) {
      const difficulty = getDifficulty(score);
      close(difficulty.gapMultiplier, gap, `gap bij ${score}`);
      close(difficulty.speedMultiplier, speed, `snelheid bij ${score}`);
    }
    assert.equal(DIFFICULTY_POINTS.length, targets.length, "geen extra of ontbrekende punten");
  });

  it("schaalt na score 1000 niet verder: nooit gap < 0,70 of snelheid > 1,05", () => {
    for (const score of [1000, 1001, 1500, 3000, 5000, 10_000, 1e9]) {
      const difficulty = getDifficulty(score);
      assert.equal(difficulty.gapMultiplier, MIN_GAP_MULTIPLIER);
      assert.equal(difficulty.speedMultiplier, MAX_SPEED_MULTIPLIER);
    }
    assert.equal(MAX_DIFFICULTY_SCORE, 1000);
    assert.equal(MIN_GAP_MULTIPLIER, 0.7);
    assert.equal(MAX_SPEED_MULTIPLIER, 1.05);
  });

  it("behandelt een negatieve of ongeldige score als score 0", () => {
    for (const score of [-1, -500, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(getDifficulty(score), getDifficulty(0));
    }
  });

  it("is deterministisch en hangt alleen van de score af", () => {
    assert.deepEqual(getDifficulty(437), getDifficulty(437));
  });
});

describe("Difficulty-curve: interpolatie", () => {
  it("interpoleert lineair tussen de punten", () => {
    const expected: [number, number, number][] = [
      [25, 0.98, 1.0025], [75, 0.94, 1.0075], [150, 0.9, 1.0125], [250, 0.86, 1.0175], [350, 0.825, 1.0225],
      [450, 0.795, 1.0275], [550, 0.77, 1.0325], [650, 0.75, 1.0375], [750, 0.73, 1.0425], [900, 0.71, 1.0475],
    ];
    for (const [score, gap, speed] of expected) {
      const difficulty = getDifficulty(score);
      close(difficulty.gapMultiplier, gap, `gap bij ${score}`);
      close(difficulty.speedMultiplier, speed, `snelheid bij ${score}`);
    }
  });

  it("wordt vloeiend en monotoon moeilijker, zonder sprongen rond de targetpunten", () => {
    let previous = getDifficulty(0);
    for (let score = 1; score <= 1200; score++) {
      const current = getDifficulty(score);
      assert.ok(current.gapMultiplier <= previous.gapMultiplier + EPS, `gap stijgt bij ${score}`);
      assert.ok(current.speedMultiplier >= previous.speedMultiplier - EPS, `snelheid daalt bij ${score}`);
      // Steilste helling: 0,04 gap per 50 punten = 0,0008 per punt; geen stap groter dan een iets ruimere marge.
      assert.ok(previous.gapMultiplier - current.gapMultiplier < 0.001, `gapsprong bij ${score}`);
      assert.ok(current.speedMultiplier - previous.speedMultiplier < 0.0002, `snelheidssprong bij ${score}`);
      previous = current;
    }
  });

  it("verandert op score 99 en 100 nauwelijks (geen plotselinge stap)", () => {
    const before = getDifficulty(99);
    const at = getDifficulty(100);
    assert.ok(before.gapMultiplier - at.gapMultiplier < 0.001);
  });
});

describe("Difficulty-curve: effectieve maten", () => {
  it("rekent de opening en snelheid uit de basismaten (182 px en 150 u/s)", () => {
    const gaps: [number, number][] = [[0, 182], [100, 167.44], [300, 152.88], [500, 141.96], [700, 134.68], [1000, 127.4]];
    const speeds: [number, number][] = [[0, 150], [100, 151.5], [300, 153], [500, 154.5], [700, 156], [1000, 157.5]];
    for (const [score, height] of gaps) close(effectiveGapHeight(score), height, `gap ${score}`);
    for (const [score, speed] of speeds) close(worldSpeed(score), speed, `snelheid ${score}`);
    assert.equal(GAP_HEIGHT, 182);
    assert.equal(HORIZONTAL_SPEED, 150);
  });

  it("laat bij 70% verticale speling over voor de hitbox", () => {
    const slack = effectiveGapHeight(1000) - MASCOT_HITBOX_HEIGHT;
    assert.ok(slack > 100, `speling ${slack}`);
  });
});

describe("Difficulty-curve: obstakelparen", () => {
  it("legt de opening van een paar vast op de score bij het aanmaken", () => {
    const pair = createObstaclePair(1, 400, () => 0.5, undefined, 700);
    close(pair.gapHeight, 134.68);
    const rects = obstacleRects(pair);
    close(rects.bottom.y - pair.gapY, pair.gapHeight);
    close(rects.top.height, pair.gapY - PLAY_TOP);
  });

  it("verankert muur aan gapBottom en rots aan gapTop met de echte opening", () => {
    for (const score of SCORES) {
      const bounds = gapYBounds(effectiveGapHeight(score));
      for (const gapY of [bounds.min, bounds.max]) {
        const pair = { id: 1, x: 200, gapY, gapHeight: effectiveGapHeight(score) };
        const wall = wallRenderRect(pair);
        const rock = rockRenderRect(pair);
        close(wall.y, gapY + pair.gapHeight, "muur begint bij gapBottom");
        close(rock.y + rock.height, gapY, "rots eindigt bij gapTop");
        assert.equal(wallCoversWorldBottom(pair), true);
        assert.equal(rockCoversWorldTop(pair), true);
        // Geen vervorming: de hoogte komt uit de uniforme schaal, nooit uit de opening.
        assert.equal(wall.height, LONG_OBSTACLE_SOURCE_HEIGHT * obstacleDisplayScale());
        assert.equal(rock.height, LONG_OBSTACLE_SOURCE_HEIGHT * obstacleDisplayScale());
        assert.equal(wall.width, OBSTACLE_WIDTH);
      }
    }
  });

  it("gebruikt voor de gapY-grenzen de werkelijke opening en houdt de marges gelijk", () => {
    for (const score of SCORES) {
      const gapHeight = effectiveGapHeight(score);
      const bounds = gapYBounds(gapHeight);
      assert.equal(bounds.min, MIN_GAP_Y);
      close(bounds.max, PLAY_BOTTOM - gapHeight - 24);
      for (const value of [0, 0.25, 0.5, 0.75, 1]) {
        const pair = createObstaclePair(1, 400, () => value, undefined, score);
        assert.ok(pair.gapY >= PLAY_TOP + 24 && pair.gapY + pair.gapHeight <= PLAY_BOTTOM - 24 + 0.5, `opening buiten de speelzone bij ${score}`);
      }
    }
  });

  it("maakt gapY niet extremer: dezelfde randen en maximale stap bij elke score", () => {
    for (const score of SCORES) {
      const random = seeded(score + 7);
      let previous: number | undefined;
      let highestTop = Infinity;
      let lowestBottom = -Infinity;
      for (let index = 0; index < 2000; index++) {
        const pair = createObstaclePair(index, 400, random, previous, score);
        if (previous !== undefined) assert.ok(Math.abs(pair.gapY - previous) <= MAX_GAP_STEP, `stap te groot bij ${score}`);
        highestTop = Math.min(highestTop, pair.gapY);
        lowestBottom = Math.max(lowestBottom, pair.gapY + pair.gapHeight);
        previous = pair.gapY;
      }
      // De hoogste top en laagste onderrand van de opening liggen nooit voorbij de marges van de basisopening.
      assert.ok(highestTop >= PLAY_TOP + 24, `top ${highestTop} bij ${score}`);
      assert.ok(lowestBottom <= PLAY_BOTTOM - 24 + 0.5, `onderrand ${lowestBottom} bij ${score}`);
    }
  });

  it("bouwt een reeks paren op de moeilijkheid van de score, met vaste paarafstand", () => {
    const pairs = createPairSequence(1001, MASCOT_X + 170, () => 0.5, 700);
    assert.equal(pairs.length, 3);
    for (const pair of pairs) close(pair.gapHeight, 134.68);
    assert.equal(pairs[1].x - pairs[0].x, PAIR_SPACING);
    assert.equal(pairs[2].x - pairs[1].x, PAIR_SPACING);
    // De opening ligt na Genees midden in de speelzone, ongeacht de grootte.
    for (const pair of pairs) assert.ok(Math.abs(pair.gapY + pair.gapHeight / 2 - (PLAY_TOP + PLAY_BOTTOM) / 2) <= 0.5, "gecentreerd (gapY is op hele pixels afgerond)");
  });

  it("houdt de paarafstand vast als alle obstakels met de wereldsnelheid bewegen", () => {
    const pairs = createPairSequence(1, FIRST_OBSTACLE_X, seeded(3), 700);
    const moved = pairs.map((pair) => ({ ...pair, x: pair.x - worldSpeed(700) * 1.5 }));
    assert.equal(Math.round((moved[1].x - moved[0].x) * 1e9) / 1e9, PAIR_SPACING);
  });
});

describe("Difficulty-curve: invarianten", () => {
  it("laat gravity, boost, hitbox, breedte en paarafstand ongewijzigd", () => {
    assert.deepEqual(
      { OBSTACLE_WIDTH, PAIR_SPACING, GRAVITY, BOOST_VELOCITY, MAX_FALL_SPEED, MASCOT_RENDER_SIZE, MASCOT_HITBOX_WIDTH, MASCOT_HITBOX_HEIGHT, MASCOT_HITBOX_OFFSET_X, MASCOT_HITBOX_OFFSET_Y, MAX_GAP_STEP, MIN_GAP_Y },
      { OBSTACLE_WIDTH: 58, PAIR_SPACING: 220, GRAVITY: 820, BOOST_VELOCITY: -285, MAX_FALL_SPEED: 430, MASCOT_RENDER_SIZE: 74, MASCOT_HITBOX_WIDTH: 32, MASCOT_HITBOX_HEIGHT: 24, MASCOT_HITBOX_OFFSET_X: 26, MASCOT_HITBOX_OFFSET_Y: 26, MAX_GAP_STEP: 105, MIN_GAP_Y: 52 },
    );
  });

  it("kent geen score of gids in de hitbox: iedere mascotte krijgt dezelfde botsing", () => {
    assert.equal(mascotHitbox.length, 1);
    assert.deepEqual(mascotHitbox({ x: 94, y: 200 }), { x: 120, y: 226, width: 32, height: 24 });
  });

  it("geeft nog steeds één punt per paar en maximaal één keer", () => {
    const pair = createObstaclePair(1, 100, () => 0.5, undefined, 700);
    assert.equal(passedPair(MASCOT_X, pair, false), MASCOT_X > pair.x + OBSTACLE_WIDTH);
    assert.equal(passedPair(300, pair, false), true);
    assert.equal(passedPair(300, pair, true), false);
    const client = read("src/components/snelleZendeling/RunClient.tsx");
    assert.match(client, /scoreRef\.current \+= 1/);
    assert.doesNotMatch(client, /scoreRef\.current \+= (?!1\b)/);
  });

  it("past de curve in de client toe met de score van deze run, niet met persoonlijke gegevens", () => {
    const client = read("src/components/snelleZendeling/RunClient.tsx");
    assert.match(client, /worldSpeed\(difficultyScore\)/);
    assert.match(client, /createObstaclePair\([^)]*difficultyScore\)/);
    assert.match(client, /createPairSequence\(1001, MASCOT_X \+ 170, \(\) => 0\.5, debugDifficultyRef\.current \?\? scoreRef\.current\)/);
    assert.match(client, /createPairSequence\(1, FIRST_OBSTACLE_X, Math\.random, debugDifficultyRef\.current \?\? 0\)/);
    assert.doesNotMatch(client, /HORIZONTAL_SPEED/, "geen vaste snelheid meer in de spelloop");
    assert.doesNotMatch(client, /allTimeBest.*difficulty|dailyBest.*difficulty/);
  });

  it("past een bestaand paar nooit meer aan: de opening wordt alleen bij het aanmaken bepaald", () => {
    const gameplay = read("src/lib/snelleZendeling/gameplay.ts");
    assert.equal((gameplay.match(/effectiveGapHeight\(/g) ?? []).length, 2, "definitie plus één plek (createObstaclePair)");
    const client = read("src/components/snelleZendeling/RunClient.tsx");
    assert.doesNotMatch(client, /gapHeight\s*[:=]/);
  });

  it("toont geen difficulty-indicator en geeft geen bonus voor een kleinere opening", () => {
    const client = read("src/components/snelleZendeling/RunClient.tsx");
    assert.doesNotMatch(client, /level-up|difficultyLabel|data-difficulty/i);
    assert.doesNotMatch(read("src/lib/snelleZendeling/runs.ts"), /difficulty/i, "de score blijft het aantal paren");
  });
});

describe("Difficulty-curve: servervalidatie", () => {
  it("houdt rekening met de snellere wereld: een echte score van 700 wordt niet als te snel geweigerd", () => {
    const started = new Date("2026-01-01T00:00:00.000Z");
    const needed = minSecondsToReachScore(700);
    const atLimit = new Date(started.getTime() + Math.ceil(needed * 1000) + 1);
    assert.ok(maxPlausibleScore(started, atLimit) >= 700);
    assert.equal(validateReportedScore(started, atLimit, 699, 700).ok, true);
    // De oude vaste ondergrens van 220/150 s per punt zou hier te weinig tijd hebben gegeven.
    assert.ok(needed < 699 * (PAIR_SPACING / HORIZONTAL_SPEED));
  });

  it("weigert een score die sneller zou zijn dan de curve toelaat", () => {
    const started = new Date("2026-01-01T00:00:00.000Z");
    const tooEarly = new Date(started.getTime() + Math.floor((minSecondsToReachScore(700) - 1) * 1000));
    assert.ok(maxPlausibleScore(started, tooEarly) < 700);
    assert.equal(validateReportedScore(started, tooEarly, 0, 700).ok, false);
    assert.equal(validateReportedScore(started, tooEarly, 0, 700).ok === false && (validateReportedScore(started, tooEarly, 0, 700) as { reason: string }).reason, "SCORE_TOO_FAST");
  });

  it("is monotoon, begint bij score 1 en blijft onder het maximum", () => {
    const started = new Date("2026-01-01T00:00:00.000Z");
    assert.equal(maxPlausibleScore(started, started), 1);
    let previous = 1;
    for (const seconds of [1, 10, 100, 1000, 5000, 20_000, 1e7]) {
      const value = maxPlausibleScore(started, new Date(started.getTime() + seconds * 1000));
      assert.ok(value >= previous && value <= MAX_RUN_SCORE);
      previous = value;
    }
    assert.equal(previous, MAX_RUN_SCORE);
    for (let score = 2; score <= 1500; score++) assert.ok(minSecondsToReachScore(score) > minSecondsToReachScore(score - 1));
  });

  it("gebruikt voorbij score 1000 de maximale snelheid, dus een vaste tijd per punt", () => {
    const step = minSecondsToReachScore(2001) - minSecondsToReachScore(2000);
    close(step, PAIR_SPACING / (HORIZONTAL_SPEED * 1.05), "tijd per punt");
  });
});

describe("Difficulty-curve: ontwikkelhulp", () => {
  it("leest ?debugDifficulty alleen als geldig getal", () => {
    assert.equal(parseDebugDifficultyScore("?debugDifficulty=700"), 700);
    assert.equal(parseDebugDifficultyScore("?x=1&debugDifficulty=0"), 0);
    assert.equal(parseDebugDifficultyScore("?debugDifficulty=-5"), null);
    assert.equal(parseDebugDifficultyScore("?debugDifficulty=abc"), null);
    assert.equal(parseDebugDifficultyScore(""), null);
  });

  it("is alleen buiten productie actief", () => {
    const client = read("src/components/snelleZendeling/RunClient.tsx");
    assert.match(client, /if \(process\.env\.NODE_ENV === "production"\) return;\s*\n\s*debugHitboxRef\.current[^\n]*\n\s*debugDifficultyRef\.current = parseDebugDifficultyScore/);
  });
});

