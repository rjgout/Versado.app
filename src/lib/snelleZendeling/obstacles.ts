import { GAP_HEIGHT, OBSTACLE_WIDTH, WORLD_HEIGHT, type ObstaclePair } from "@/lib/snelleZendeling/gameplay";

/** De bronassets delen deze breedte; gameplay blijft van de bitmap onafhankelijk. */
export const OBSTACLE_SOURCE_WIDTH = 384;
export const LONG_OBSTACLE_SOURCE_HEIGHT = 16_384;

export interface ObstacleRenderRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Obstakels krijgen uitsluitend een uniforme schaal. Hun hoogte mag nooit de
 * opening volgen: alleen de geclipte zichtbare lengte verandert per gapY.
 */
export function obstacleDisplayScale(width = OBSTACLE_WIDTH): number {
  return width / OBSTACLE_SOURCE_WIDTH;
}

export function uniformlyScaledObstacleHeight(sourceHeight: number, width = OBSTACLE_WIDTH): number {
  return sourceHeight * obstacleDisplayScale(width);
}

/** De bovenkant van de muur is het unieke, naar de opening gerichte anker. */
export function wallRenderRect(pair: ObstaclePair, sourceHeight = LONG_OBSTACLE_SOURCE_HEIGHT): ObstacleRenderRect {
  return {
    x: pair.x,
    y: pair.gapY + GAP_HEIGHT,
    width: OBSTACLE_WIDTH,
    height: uniformlyScaledObstacleHeight(sourceHeight),
  };
}

/** De onderkant van de rots is het unieke, naar de opening gerichte anker. */
export function rockRenderRect(pair: ObstaclePair, sourceHeight = LONG_OBSTACLE_SOURCE_HEIGHT): ObstacleRenderRect {
  const height = uniformlyScaledObstacleHeight(sourceHeight);
  return { x: pair.x, y: pair.gapY - height, width: OBSTACLE_WIDTH, height };
}

export function wallCoversWorldBottom(pair: ObstaclePair): boolean {
  const wall = wallRenderRect(pair);
  return wall.y + wall.height >= WORLD_HEIGHT;
}

export function rockCoversWorldTop(pair: ObstaclePair): boolean {
  return rockRenderRect(pair).y <= 0;
}
