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
export const HORIZONTAL_SPEED = 150;
export const MAX_FALL_SPEED = 430;

// Deze drie maten vormen het vaste fair-play contract: alleen gapY mag variëren.
export const OBSTACLE_WIDTH = 58;
export const GAP_HEIGHT = 182;
export const PAIR_SPACING = 220;
export const FIRST_OBSTACLE_X = WORLD_WIDTH + 105;
export const MASCOT_X = 94;
export const MASCOT_HITBOX_WIDTH = 42;
export const MASCOT_HITBOX_HEIGHT = 42;
export const MASCOT_HITBOX_OFFSET_X = 5;
export const MASCOT_HITBOX_OFFSET_Y = 5;

export const MIN_GAP_Y = PLAY_TOP + 24;
export const MAX_GAP_Y = PLAY_BOTTOM - GAP_HEIGHT - 24;
export const MAX_GAP_STEP = 105;

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
}

export function clampGapY(value: number): number {
  return Math.max(MIN_GAP_Y, Math.min(MAX_GAP_Y, value));
}

/** Alleen verticale openingposities worden willekeurig gekozen. */
export function nextGapY(random: () => number, previousGapY?: number): number {
  const candidate = MIN_GAP_Y + random() * (MAX_GAP_Y - MIN_GAP_Y);
  if (previousGapY === undefined) return Math.round(candidate);
  return Math.round(clampGapY(previousGapY + Math.max(-MAX_GAP_STEP, Math.min(MAX_GAP_STEP, candidate - previousGapY))));
}

export function createObstaclePair(id: number, x: number, random: () => number, previousGapY?: number): ObstaclePair {
  return { id, x, gapY: nextGapY(random, previousGapY) };
}

export function mascotHitbox(body: MascotBody): { x: number; y: number; width: number; height: number } {
  return {
    x: body.x + MASCOT_HITBOX_OFFSET_X,
    y: body.y + MASCOT_HITBOX_OFFSET_Y,
    width: MASCOT_HITBOX_WIDTH,
    height: MASCOT_HITBOX_HEIGHT,
  };
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function obstacleRects(pair: ObstaclePair): { top: { x: number; y: number; width: number; height: number }; bottom: { x: number; y: number; width: number; height: number } } {
  return {
    top: { x: pair.x, y: PLAY_TOP, width: OBSTACLE_WIDTH, height: pair.gapY - PLAY_TOP },
    bottom: { x: pair.x, y: pair.gapY + GAP_HEIGHT, width: OBSTACLE_WIDTH, height: WORLD_HEIGHT },
  };
}

export function collidesWithObstacle(body: MascotBody, pair: ObstaclePair): boolean {
  const hitbox = mascotHitbox(body);
  const rects = obstacleRects(pair);
  return overlaps(hitbox, rects.top) || overlaps(hitbox, rects.bottom);
}

export function isOutOfPlayZone(body: MascotBody): boolean {
  const hitbox = mascotHitbox(body);
  return hitbox.y < PLAY_TOP || hitbox.y + hitbox.height > PLAY_BOTTOM;
}

/** Een paar levert precies één punt op, ook als meerdere frames eroverheen gaan. */
export function passedPair(bodyX: number, pair: ObstaclePair, alreadyScored: boolean): boolean {
  return !alreadyScored && bodyX > pair.x + OBSTACLE_WIDTH;
}

export function stepPhysics(y: number, velocity: number, deltaSeconds: number, boosted: boolean): { y: number; velocity: number } {
  const dt = Math.max(0, Math.min(deltaSeconds, 0.05));
  const nextVelocity = boosted ? BOOST_VELOCITY : Math.min(MAX_FALL_SPEED, velocity + GRAVITY * dt);
  return { y: y + nextVelocity * dt, velocity: nextVelocity };
}
