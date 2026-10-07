import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BOOST_VELOCITY, FIRST_OBSTACLE_X, GAP_HEIGHT, GRAVITY, HORIZONTAL_SPEED, MASCOT_HITBOX_HEIGHT, MASCOT_HITBOX_WIDTH,
  MASCOT_RENDER_SIZE, MASCOT_X, MAX_FALL_SPEED, MAX_GAP_STEP, MAX_GAP_Y, MIN_GAP_Y, OBSTACLE_WIDTH, PAIR_SPACING,
  WORLD_HEIGHT, WORLD_WIDTH, collidesWithObstacle, isOutOfPlayZone, mascotHitbox, mascotHitboxEllipse,
  type ObstaclePair,
} from "@/lib/snelleZendeling/gameplay";
import { quickMissionaryMascotSprite } from "@/lib/snelleZendeling/assets";
import { PERSONAL_MASCOTS } from "@/lib/mascots";
import { opaqueGrid } from "./helpers/pngAlpha";

const ASSETS = path.join(process.cwd(), "public", "games", "snelle-zendeling");
const SCALE = 2; // supersampling van het silhouet: halve wereldpixels
const POSES = ["glide", "boost"] as const;

const sprites = PERSONAL_MASCOTS.flatMap((character) =>
  POSES.map((pose) => {
    const name = quickMissionaryMascotSprite(character, pose);
    return { character, pose, name, ...opaqueGrid(path.join(ASSETS, name), MASCOT_RENDER_SIZE, SCALE) };
  })
);

/** Kleinste afstand (wereldpx) van een punt tot ondoorzichtig sprite-materiaal; 99 als er niets binnen 14 px ligt. */
function distanceToBody(grid: Uint8Array, cells: number, x: number, y: number): number {
  const reach = 14 * SCALE;
  const cx = Math.round(x * SCALE), cy = Math.round(y * SCALE);
  let best = Infinity;
  for (let gy = Math.max(0, cy - reach); gy <= Math.min(cells - 1, cy + reach); gy++) {
    for (let gx = Math.max(0, cx - reach); gx <= Math.min(cells - 1, cx + reach); gx++) {
      if (!grid[gy * cells + gx]) continue;
      best = Math.min(best, Math.hypot((gx + 0.5) / SCALE - x, (gy + 0.5) / SCALE - y));
    }
  }
  return Number.isFinite(best) ? best : 99;
}

type Shape = { kind: "ellips" | "rechthoek"; x: number; y: number; width: number; height: number };
const CURRENT: Shape = { kind: "ellips", x: 26, y: 26, width: MASCOT_HITBOX_WIDTH, height: MASCOT_HITBOX_HEIGHT };
// De box van vóór deze wijziging (42x42 op 5,5), alleen als meetlat om te bewijzen dat de test iets meet.
const PREVIOUS: Shape = { kind: "rechthoek", x: 5, y: 5, width: 42, height: 42 };

function outline(shape: Shape): [number, number][] {
  const points: [number, number][] = [];
  for (let i = 0; i < 180; i++) {
    const t = (i / 180) * Math.PI * 2;
    if (shape.kind === "ellips") points.push([shape.x + shape.width / 2 + (shape.width / 2) * Math.cos(t), shape.y + shape.height / 2 + (shape.height / 2) * Math.sin(t)]);
  }
  if (shape.kind === "rechthoek") {
    for (let i = 0; i <= 60; i++) {
      const f = i / 60;
      points.push([shape.x + f * shape.width, shape.y], [shape.x + f * shape.width, shape.y + shape.height], [shape.x, shape.y + f * shape.height], [shape.x + shape.width, shape.y + f * shape.height]);
    }
  }
  return points;
}

/** Hoe ver de rand van de hitbox ergens van zichtbaar lichaam af ligt: 0 = ligt overal op het dier. */
function deadSpace(shape: Shape, sprite: (typeof sprites)[number]): number {
  return Math.max(...outline(shape).map(([x, y]) => distanceToBody(sprite.grid, sprite.cells, x, y)));
}

const body = (y: number) => ({ x: MASCOT_X, y });
/** Een obstakel dat horizontaal precies over het midden van de hitbox valt; alleen gapY verschilt. */
const pairOverHitbox = (y: number, gapY: number): ObstaclePair => ({ id: 1, x: mascotHitboxEllipse(body(y)).cx - OBSTACLE_WIDTH / 2, gapY });

describe("Snelle Zendeling hitbox", () => {
  it("meet alle zes de sprites (drie gidsen, glide en boost)", () => {
    assert.equal(sprites.length, 6);
    for (const sprite of sprites) assert.ok(sprite.bounds.right > sprite.bounds.left, `${sprite.name} heeft geen zichtbaar silhouet`);
  });

  it("legt de hitbox op het lichaam: de rand ligt overal dicht bij zichtbaar dier", () => {
    for (const sprite of sprites) {
      const dead = deadSpace(CURRENT, sprite);
      assert.ok(dead <= 6.5, `${sprite.name}: hitboxrand ligt ${dead.toFixed(1)} px los van het dier`);
    }
  });

  it("bewijst dat de vorige box niet op het lichaam lag (de meting heeft tanden)", () => {
    for (const sprite of sprites) {
      assert.ok(deadSpace(PREVIOUS, sprite) > 20, `${sprite.name}: de oude box zou nu niet meer als fout opvallen`);
      assert.ok(sprite.bounds.top - PREVIOUS.y > 8, `${sprite.name}: boven het dier telde lucht mee als botsing`);
    }
  });

  it("laat oorpunten, haartoefjes en transparante rand buiten de hitbox", () => {
    for (const sprite of sprites) {
      // spritecoördinaten (linkerbovenhoek van de getekende sprite = 0,0), zoals sprite.bounds
      const hitbox = mascotHitbox({ x: 0, y: 0 });
      const aboveHitbox = hitbox.y - sprite.bounds.top;
      assert.ok(aboveHitbox >= 5, `${sprite.name}: bovenkant van het silhouet steekt maar ${aboveHitbox} px boven de hitbox uit`);
      assert.ok(aboveHitbox <= 11.5, `${sprite.name}: hitbox zit te laag onder de kop`);
      const belowHitbox = sprite.bounds.bottom - (hitbox.y + hitbox.height);
      assert.ok(belowHitbox >= -1 && belowHitbox <= 5.5, `${sprite.name}: onderkant wijkt ${belowHitbox} px af`);
      const aheadOfHitbox = sprite.bounds.right - (hitbox.x + hitbox.width);
      assert.ok(aheadOfHitbox >= -1 && aheadOfHitbox <= 4, `${sprite.name}: neus wijkt ${aheadOfHitbox} px af`);
      // de staart (links) en de transparante rand tellen niet mee
      assert.ok(hitbox.x - sprite.bounds.left >= 9, `${sprite.name}: staart zit in de hitbox`);
    }
  });

  it("geeft Varo, Vera en Novi exact dezelfde hitbox, ook bij glide en boost", () => {
    // De hitbox is een functie van alleen de positie: geen gids, pose of spritemaat.
    assert.equal(mascotHitbox.length, 1);
    assert.equal(collidesWithObstacle.length, 2);
    const boxes = sprites.map(() => JSON.stringify([mascotHitbox(body(300)), mascotHitboxEllipse(body(300))]));
    assert.equal(new Set(boxes).size, 1);
    const source = readFileSync(path.join(process.cwd(), "src/lib/snelleZendeling/gameplay.ts"), "utf8");
    // de spelregels kennen geen gids en geen pose; BOOST_VELOCITY is de enige "boost"
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/BOOST_VELOCITY/g, "");
    assert.doesNotMatch(code, /\b(novi|varo|vera|character|companion|pose|glide|boost)\b/i);
    const renderer = readFileSync(path.join(process.cwd(), "src/components/snelleZendeling/RunClient.tsx"), "utf8");
    assert.match(renderer, /collidesWithObstacle\(\{ x: MASCOT_X, y: yRef\.current \}, pair\)/);
    // alle sprites delen één canvas, zodat één renderformaat voor allen klopt
    for (const sprite of sprites) assert.equal(sprite.cells, MASCOT_RENDER_SIZE * SCALE);
  });

  it("laat een near miss langs de bovenste rots leven, ook als oorpunten erin steken", () => {
    for (const sprite of sprites) {
      const y = 300;
      const top = mascotHitbox(body(y)).y;
      const pair = pairOverHitbox(y, top - 0.5); // rotsonderkant net boven de hitbox
      assert.equal(collidesWithObstacle(body(y), pair), false, `${sprite.name}: near miss boven kostte een leven`);
      assert.ok(y + sprite.bounds.top < pair.gapY - 5, `${sprite.name}: er steekt minder dan 5 px dier in de rots`);
    }
  });

  it("laat een near miss langs de onderste muur leven", () => {
    for (const sprite of sprites) {
      const y = 300;
      const hitbox = mascotHitbox(body(y));
      const pair = pairOverHitbox(y, hitbox.y + hitbox.height + 0.5 - GAP_HEIGHT); // muurbovenkant net onder de hitbox
      assert.equal(collidesWithObstacle(body(y), pair), false, `${sprite.name}: near miss onder kostte een leven`);
    }
  });

  it("laat een near miss langs de voorkant van een obstakel leven", () => {
    const y = 300;
    const hitbox = mascotHitbox(body(y));
    // de linkerrand van de rots/muur raakt de neus nét niet; gap ver weg zodat het lichaam in de rots-/muurhoogte ligt
    const wall: ObstaclePair = { id: 1, x: hitbox.x + hitbox.width + 0.5, gapY: y - GAP_HEIGHT - 80 };
    assert.equal(collidesWithObstacle(body(y), wall), false);
    const rock: ObstaclePair = { id: 2, x: hitbox.x + hitbox.width + 0.5, gapY: y + 200 };
    assert.equal(collidesWithObstacle(body(y), rock), false);
  });

  it("botst wanneer het lichaam de bovenste rots echt raakt", () => {
    const y = 300;
    const ellipse = mascotHitboxEllipse(body(y));
    assert.equal(collidesWithObstacle(body(y), pairOverHitbox(y, ellipse.cy - 2)), true, "romp midden in de rots");
    assert.equal(collidesWithObstacle(body(y), pairOverHitbox(y, mascotHitbox(body(y)).y + 2)), true, "bovenkant lichaam 2 px in de rots");
  });

  it("botst wanneer het lichaam de onderste muur echt raakt", () => {
    const y = 300;
    const ellipse = mascotHitboxEllipse(body(y));
    const hitbox = mascotHitbox(body(y));
    assert.equal(collidesWithObstacle(body(y), pairOverHitbox(y, ellipse.cy + 2 - GAP_HEIGHT)), true, "romp midden in de muur");
    assert.equal(collidesWithObstacle(body(y), pairOverHitbox(y, hitbox.y + hitbox.height - 2 - GAP_HEIGHT)), true, "onderkant lichaam 2 px in de muur");
  });

  it("botst wanneer de neus voorin een obstakel steekt", () => {
    const y = 300;
    const ellipse = mascotHitboxEllipse(body(y));
    const wall: ObstaclePair = { id: 1, x: ellipse.cx + ellipse.rx - 3, gapY: y - GAP_HEIGHT - 80 };
    assert.equal(collidesWithObstacle(body(y), wall), true);
  });

  it("rondt de hoeken af: de uiterste hoek van de omsluitende rechthoek raakt niet", () => {
    const y = 300;
    const box = mascotHitbox(body(y));
    // rotsrand die alleen de hoek van de omsluitende rechthoek zou raken
    const cornerRock: ObstaclePair = { id: 1, x: box.x + box.width - 3, gapY: box.y + 3 };
    assert.equal(collidesWithObstacle(body(y), cornerRock), false);
  });

  it("gebruikt dezelfde hitbox bij glide en boost (geen geometrie per pose)", () => {
    const renderer = readFileSync(path.join(process.cwd(), "src/components/snelleZendeling/RunClient.tsx"), "utf8");
    // pose bepaalt alleen welke afbeelding getekend wordt, niet de botsing
    assert.match(renderer, /timestamp < boostUntilRef\.current \? "boost" : "glide"/);
    assert.doesNotMatch(renderer, /collidesWithObstacle\([^)]*(boost|glide|character)/);
  });

  it("verandert de speelzone niet door de hitbox: bovenrand en grond blijven dezelfde grenzen", () => {
    assert.equal(isOutOfPlayZone(body(300)), false);
    assert.equal(isOutOfPlayZone(body(-10)), true);
    assert.equal(isOutOfPlayZone(body(560)), true);
  });

  it("laat obstakelmaten, gap en alle physics ongewijzigd", () => {
    assert.deepEqual(
      { OBSTACLE_WIDTH, GAP_HEIGHT, PAIR_SPACING, GRAVITY, BOOST_VELOCITY, HORIZONTAL_SPEED, MAX_FALL_SPEED, MAX_GAP_STEP, MIN_GAP_Y, MAX_GAP_Y, WORLD_WIDTH, WORLD_HEIGHT, FIRST_OBSTACLE_X, MASCOT_X },
      { OBSTACLE_WIDTH: 58, GAP_HEIGHT: 182, PAIR_SPACING: 220, GRAVITY: 820, BOOST_VELOCITY: -285, HORIZONTAL_SPEED: 150, MAX_FALL_SPEED: 430, MAX_GAP_STEP: 105, MIN_GAP_Y: 52, MAX_GAP_Y: 386, WORLD_WIDTH: 360, WORLD_HEIGHT: 640, FIRST_OBSTACLE_X: 465, MASCOT_X: 94 }
    );
  });

  it("toont de debug-hitbox nooit in productie en houdt de maten centraal", () => {
    const renderer = readFileSync(path.join(process.cwd(), "src/components/snelleZendeling/RunClient.tsx"), "utf8");
    assert.match(renderer, /if \(process\.env\.NODE_ENV === "production"\) return;\s*\n\s*debugHitboxRef\.current/);
    assert.match(renderer, /process\.env\.NODE_ENV !== "production" && debugHitboxRef\.current/);
    // geen losse hitbox- of spritegetallen in de renderer
    assert.doesNotMatch(renderer, /const MASCOT_RENDER_SIZE|\b74\b|\b42\b/);
  });
});
