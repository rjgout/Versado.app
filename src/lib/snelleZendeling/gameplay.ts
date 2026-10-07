import { getDifficulty } from "./difficulty";

/**
 * Pure spelregels voor Snelle Zendeling. De renderer gebruikt deze logische
 * wereld, zodat een telefoon, tablet en desktop exact dezelfde physics delen.
 */
export const WORLD_WIDTH = 360;
export const WORLD_HEIGHT = 640;
export const PLAY_TOP = 28;
export const GROUND_HEIGHT = 48;
export const PLAY_BOTTOM = WORLD_HEIGHT - GROUND_HEIGHT;

export const GRAVITY = 820;
export const BOOST_VELOCITY = -285;
/** Basissnelheid (100%) van de wereld; de difficulty-curve verhoogt hem hooguit 5%. */
export const HORIZONTAL_SPEED = 150;
export const MAX_FALL_SPEED = 430;

// Breedte en paarafstand zijn vast; de opening start op GAP_HEIGHT (100%) en
// wordt per nieuw paar kleiner volgens de difficulty-curve (difficulty.ts).
// Daarnaast varieert alleen gapY.
export const OBSTACLE_WIDTH = 58;
/** Basisopening (100%) aan het begin van iedere run. */
export const GAP_HEIGHT = 182;
export const PAIR_SPACING = 220;
export const FIRST_OBSTACLE_X = WORLD_WIDTH + 105;
export const MASCOT_X = 94;
/** Getekende maat van de mascotte in wereldpixels (de 1254x1254-sprite wordt hiernaartoe geschaald). */
export const MASCOT_RENDER_SIZE = 74;

// Eén vaste gameplay-hitbox voor elke gids en elke pose (glide én boost): een
// ellips op romp en kop, relatief aan de linkerbovenhoek van de getekende
// sprite. De staart, losse haartoefjes, oorpunten en de transparante rand van
// de sprite tellen bewust niet mee. De maten zijn gemeten aan de zes echte
// sprites (tests/snelle-zendeling.test.ts leest ze opnieuw uit de PNG's): de
// rand van de ellips ligt overal hooguit enkele pixels van zichtbaar lichaam,
// terwijl de vorige box 24-28 px los van het dier zweefde (10-14 px boven de
// oren en 11-14 px achter de neus).
export const MASCOT_HITBOX_WIDTH = 32;
export const MASCOT_HITBOX_HEIGHT = 24;
export const MASCOT_HITBOX_OFFSET_X = 26;
export const MASCOT_HITBOX_OFFSET_Y = 26;

const GAP_MARGIN = 24;
export const MIN_GAP_Y = PLAY_TOP + GAP_MARGIN;
/** Onderste gapY bij de basisopening; zie gapYBounds voor een kleinere opening. */
export const MAX_GAP_Y = PLAY_BOTTOM - GAP_HEIGHT - GAP_MARGIN;
export const MAX_GAP_STEP = 105;

/** Opening van een nieuw paar bij deze runscore (zie difficulty.ts). */
export function effectiveGapHeight(score: number): number {
  return GAP_HEIGHT * getDifficulty(score).gapMultiplier;
}

/** Wereldsnelheid bij deze runscore; alle obstakels delen haar, dus de paarafstand blijft PAIR_SPACING. */
export function worldSpeed(score: number): number {
  return HORIZONTAL_SPEED * getDifficulty(score).speedMultiplier;
}

/**
 * Geldige gapY voor een opening van deze hoogte, met dezelfde veiligheidsmarges
 * boven en onder als bij de basisopening: de opening blijft volledig in de speelzone.
 */
export function gapYBounds(gapHeight: number): { min: number; max: number } {
  return { min: MIN_GAP_Y, max: PLAY_BOTTOM - gapHeight - GAP_MARGIN };
}

export interface MascotBody {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface ObstaclePair {
  id: number;
  x: number;
  gapY: number;
  /** Opening van dit paar; ligt vast bij het aanmaken en verandert daarna niet meer. */
  gapHeight: number;
}

export function clampGapY(value: number, gapHeight: number): number {
  const bounds = gapYBounds(gapHeight);
  return Math.max(bounds.min, Math.min(bounds.max, value));
}

/** Alleen verticale openingposities worden willekeurig gekozen, nooit extremer door de score. */
export function nextGapY(random: () => number, previousGapY: number | undefined, gapHeight: number): number {
  const bounds = gapYBounds(gapHeight);
  const candidate = bounds.min + random() * (bounds.max - bounds.min);
  if (previousGapY === undefined) return Math.round(candidate);
  return Math.round(clampGapY(previousGapY + Math.max(-MAX_GAP_STEP, Math.min(MAX_GAP_STEP, candidate - previousGapY)), gapHeight));
}

/** `score` is de actuele score van deze run op het moment dat het paar ontstaat. */
export function createObstaclePair(id: number, x: number, random: () => number, previousGapY: number | undefined, score: number): ObstaclePair {
  const gapHeight = effectiveGapHeight(score);
  return { id, x, gapY: nextGapY(random, previousGapY, gapHeight), gapHeight };
}

/** Drie paren voor de start of na een Genees, allemaal op de moeilijkheid van de actuele score. */
export function createPairSequence(firstId: number, firstX: number, random: () => number, score: number, count = 3): ObstaclePair[] {
  const pairs: ObstaclePair[] = [];
  for (let index = 0; index < count; index++) {
    pairs.push(createObstaclePair(firstId + index, firstX + PAIR_SPACING * index, random, pairs[index - 1]?.gapY, score));
  }
  return pairs;
}

/** Omsluitende rechthoek van de hitbox; voor de speelzone en de debugweergave. */
export function mascotHitbox(body: MascotBody): { x: number; y: number; width: number; height: number } {
  return {
    x: body.x + MASCOT_HITBOX_OFFSET_X,
    y: body.y + MASCOT_HITBOX_OFFSET_Y,
    width: MASCOT_HITBOX_WIDTH,
    height: MASCOT_HITBOX_HEIGHT,
  };
}

export interface HitboxEllipse {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export function mascotHitboxEllipse(body: MascotBody): HitboxEllipse {
  const box = mascotHitbox(body);
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2, rx: box.width / 2, ry: box.height / 2 };
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Exacte ellips-rechthoektest: deel x en y door de stralen, dan is de ellips
 * een eenheidscirkel en blijft de rechthoek asgelijnd. Alleen raken telt niet.
 */
function ellipseOverlapsRect(ellipse: HitboxEllipse, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(ellipse.cx, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(ellipse.cy, rect.y + rect.height));
  const dx = (nearestX - ellipse.cx) / ellipse.rx;
  const dy = (nearestY - ellipse.cy) / ellipse.ry;
  return dx * dx + dy * dy < 1;
}

export function obstacleRects(pair: ObstaclePair): { top: { x: number; y: number; width: number; height: number }; bottom: { x: number; y: number; width: number; height: number } } {
  return {
    top: { x: pair.x, y: PLAY_TOP, width: OBSTACLE_WIDTH, height: pair.gapY - PLAY_TOP },
    bottom: { x: pair.x, y: pair.gapY + pair.gapHeight, width: OBSTACLE_WIDTH, height: WORLD_HEIGHT },
  };
}

export function collidesWithObstacle(body: MascotBody, pair: ObstaclePair): boolean {
  const ellipse = mascotHitboxEllipse(body);
  const rects = obstacleRects(pair);
  return ellipseOverlapsRect(ellipse, rects.top) || ellipseOverlapsRect(ellipse, rects.bottom);
}

export function isOutOfPlayZone(body: MascotBody): boolean {
  const hitbox = mascotHitbox(body);
  return hitbox.y < PLAY_TOP || hitbox.y + hitbox.height > PLAY_BOTTOM;
}

/** Een paar levert precies één punt op, ook als meerdere frames eroverheen gaan. */
export function passedPair(bodyX: number, pair: ObstaclePair, alreadyScored: boolean): boolean {
  return !alreadyScored && bodyX > pair.x + OBSTACLE_WIDTH;
}

export function stepPhysics(y: number, velocity: number, deltaSeconds: number): { y: number; velocity: number } {
  const dt = Math.max(0, Math.min(deltaSeconds, 0.05));
  // De tik zet de snelheid eenmalig op BOOST_VELOCITY. De boostsprite blijft
  // kort zichtbaar, maar mag de impuls niet elk frame opnieuw toepassen.
  const nextVelocity = Math.min(MAX_FALL_SPEED, velocity + GRAVITY * dt);
  return { y: y + nextVelocity * dt, velocity: nextVelocity };
}
