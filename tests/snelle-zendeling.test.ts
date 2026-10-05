import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  PLAY_TOP,
  WORLD_HEIGHT,
  collidesWithObstacle,
  createObstaclePair,
  mascotHitbox,
  obstacleRects,
  passedPair,
  stepPhysics,
} from "@/lib/snelleZendeling/gameplay";
import {
  LONG_OBSTACLE_SOURCE_HEIGHT,
  OBSTACLE_SOURCE_WIDTH,
  obstacleDisplayScale,
  rockCoversWorldTop,
  rockRenderRect,
  wallCoversWorldBottom,
  wallRenderRect,
} from "@/lib/snelleZendeling/obstacles";
import { maxPlausibleScore, validateReportedScore } from "@/lib/snelleZendeling/validation";
import { applyReviveAnswer, reviveOptionsAreComparable, reviveQuestionContext, selectReviveOptions } from "@/lib/snelleZendeling/rules";
import { rankScores } from "@/lib/snelleZendeling/ranking";
import { GAME_CATALOG, gameTitle } from "@/lib/gameCatalog";
import { PERSONAL_MASCOTS } from "@/lib/mascots";
import { quickMissionaryMascotSprite } from "@/lib/snelleZendeling/assets";
import { gameArtworkKeys, artworkFor } from "@/lib/artwork";
import { translateWith } from "@/lib/i18n/core";
import { en } from "@/lib/i18n/messages/en";
import { de } from "@/lib/i18n/messages/de";
import { fr } from "@/lib/i18n/messages/fr";
import { es } from "@/lib/i18n/messages/es";

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

  it("gebruikt gelijkbrede lange bronassets voor muur en rots", () => {
    const pngSize = (name: string) => {
      const png = readFileSync(path.join(process.cwd(), "public", "games", "snelle-zendeling", name));
      return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    };
    assert.deepEqual(pngSize("obstacle-wall-long.png"), { width: OBSTACLE_SOURCE_WIDTH, height: LONG_OBSTACLE_SOURCE_HEIGHT });
    assert.deepEqual(pngSize("obstacle-rock-long.png"), { width: OBSTACLE_SOURCE_WIDTH, height: LONG_OBSTACLE_SOURCE_HEIGHT });
    assert.deepEqual(pngSize("obstacle-wall-stem.png"), { width: OBSTACLE_SOURCE_WIDTH, height: 960 });
    assert.deepEqual(pngSize("obstacle-rock-stem.png"), { width: OBSTACLE_SOURCE_WIDTH, height: 912 });
  });

  it("verankert de lange muur en rots exact aan de vaste gapranden", () => {
    for (const gapY of [MIN_GAP_Y, MAX_GAP_Y]) {
      const pair = { id: 1, x: 200, gapY };
      const wall = wallRenderRect(pair);
      const rock = rockRenderRect(pair);
      assert.equal(wall.width, OBSTACLE_WIDTH);
      assert.equal(rock.width, OBSTACLE_WIDTH);
      assert.equal(wall.y, gapY + GAP_HEIGHT, "muur begint bij gapBottom");
      assert.equal(rock.y + rock.height, gapY, "rots eindigt bij gapTop");
      assert.equal(wallCoversWorldBottom(pair), true, "muur loopt voorbij de onderkant");
      assert.equal(rockCoversWorldTop(pair), true, "rots loopt voorbij de bovenkant");
      assert.ok(wall.y + wall.height >= WORLD_HEIGHT);
      assert.ok(rock.y <= 0);
    }
  });

  it("schaalt lange obstakels uniform en verandert collision niet met bitmaphoogte", () => {
    const pair = { id: 1, x: 100, gapY: MIN_GAP_Y };
    const wall = wallRenderRect(pair);
    const rock = rockRenderRect(pair);
    assert.equal(wall.height, LONG_OBSTACLE_SOURCE_HEIGHT * obstacleDisplayScale());
    assert.equal(rock.height, LONG_OBSTACLE_SOURCE_HEIGHT * obstacleDisplayScale());
    assert.equal(obstacleRects(pair).bottom.y, pair.gapY + GAP_HEIGHT);
    assert.equal(obstacleRects(pair).top.height, pair.gapY - PLAY_TOP);
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

  it("kiest alleen antwoordsets waarvan lengte het juiste antwoord niet verraadt", () => {
    const balanced = selectReviveOptions([
      { id: "good", label: "Hij vraagt de Heer om hulp", isCorrect: true },
      { id: "short", label: "Hij vertrekt", isCorrect: false },
      { id: "close-1", label: "Hij vertrouwt op zijn eigen kracht", isCorrect: false },
      { id: "close-2", label: "Hij luistert naar raad van zijn familie", isCorrect: false },
    ]);
    assert.equal(balanced?.length, 3);
    assert.equal(reviveOptionsAreComparable(balanced ?? []), true);
    assert.equal(balanced?.some((option) => option.id === "short"), false);
    assert.equal(selectReviveOptions([
      { id: "good", label: "Een uitvoerig en zeer specifiek correct antwoord met veel inhoud", isCorrect: true },
      { id: "wrong-1", label: "Nee", isCorrect: false },
      { id: "wrong-2", label: "Ja", isCorrect: false },
    ]), null);
  });

  it("toont echte hoofdstukcontext en verzint geen context zonder metadata", () => {
    assert.deepEqual(reviveQuestionContext({ chapter: { number: 32, book: { name: "Alma" } } }), { kind: "chapter", label: "Alma 32" });
    assert.equal(reviveQuestionContext({}), null);
    assert.equal(reviveQuestionContext({ chapter: { number: 1, book: null } }), null);
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

  it("gebruikt de persoonlijke gids voor naam en cover zonder een nieuw spel te maken", () => {
    const game = GAME_CATALOG.find((entry) => entry.id === "quick-missionary")!;
    const t = (key: Parameters<typeof translateWith>[1], vars?: Parameters<typeof translateWith>[2]) => translateWith(undefined, key, vars);
    assert.equal(gameTitle(t, game, "novi"), "Vliegende Novi");
    assert.equal(gameTitle(t, game, "varo"), "Vliegende Varo");
    assert.equal(gameTitle(t, game, "vera"), "Vliegende Vera");
    assert.equal(gameTitle((key, vars) => translateWith(en, key, vars), game, "vera"), "Flying Vera");
    assert.equal(gameTitle((key, vars) => translateWith(de, key, vars), game, "vera"), "Mit Vera fliegen");
    assert.equal(gameTitle((key, vars) => translateWith(fr, key, vars), game, "vera"), "Vera prend son envol");
    assert.equal(gameTitle((key, vars) => translateWith(es, key, vars), game, "vera"), "Vuela con Vera");
    assert.equal(GAME_CATALOG.filter((entry) => entry.id === "quick-missionary").length, 1);
    assert.equal(artworkFor(gameArtworkKeys(game.id, "novi"))?.src, "/images/games/snelle-zendeling.png");
    assert.equal(artworkFor(gameArtworkKeys(game.id, "varo"))?.src, "/images/games/vliegende-varo.png");
    assert.equal(artworkFor(gameArtworkKeys(game.id, "vera"))?.src, "/images/games/vliegende-vera.png");
    const page = readFileSync(path.join(process.cwd(), "src/app/snelle-zendeling/run/[runId]/page.tsx"), "utf8");
    assert.match(page, /companionToMascot\(user\.companion\)/);
    assert.doesNotMatch(page, /preference|localStorage/);
  });

  it("houdt score, instructie, Genees en veilige exits binnen de immersive game-area", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/snelleZendeling/RunClient.tsx"), "utf8");
    const server = readFileSync(path.join(process.cwd(), "src/lib/snelleZendeling/runs.ts"), "utf8");
    assert.match(source, /ImmersiveLayout/);
    assert.match(source, /data-game-score/);
    assert.match(source, /data-game-overlay/);
    assert.match(source, /quickMissionary\.heal/);
    assert.match(source, /overflow-y-auto/);
    assert.match(source, /!whitespace-normal/);
    assert.match(source, /quickMissionary\.backToGames/);
    assert.match(source, /keepalive: true/);
    assert.doesNotMatch(source, /SubpageBackBar|FocusLayout/);
    assert.doesNotMatch(server, /recordLearningActivity|competitionXp|awardXp/);
  });
});
