import {
  MASCOT_RENDER_SIZE, WORLD_HEIGHT, mascotHitbox, mascotHitboxEllipse, obstacleRects,
  type MascotBody, type ObstaclePair,
} from "@/lib/snelleZendeling/gameplay";

/**
 * Alleen voor ontwikkeling (`?debugHitbox=1`, nooit in productie; zie RunClient):
 * tekent de werkelijke gameplaygeometrie over de sprites en obstakels heen.
 * Rood = de hitbox waarmee gebotst wordt, wit = de getekende spritegrenzen,
 * geel = de botsrechthoeken van de obstakels, groen = de opening.
 */
export function drawHitboxDebug(ctx: CanvasRenderingContext2D, body: MascotBody, pairs: ObstaclePair[]): void {
  ctx.save();
  ctx.lineWidth = 1;

  for (const pair of pairs) {
    const rects = obstacleRects(pair);
    ctx.strokeStyle = "rgba(250, 204, 21, 0.95)";
    ctx.strokeRect(rects.top.x + 0.5, rects.top.y + 0.5, rects.top.width, rects.top.height);
    ctx.strokeRect(rects.bottom.x + 0.5, rects.bottom.y + 0.5, rects.bottom.width, Math.min(rects.bottom.height, WORLD_HEIGHT - rects.bottom.y));
    ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(pair.x + 0.5, pair.gapY + 0.5, rects.top.width, pair.gapHeight);
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.strokeRect(body.x + 0.5, body.y + 0.5, MASCOT_RENDER_SIZE, MASCOT_RENDER_SIZE);

  const box = mascotHitbox(body);
  ctx.strokeStyle = "rgba(239, 68, 68, 0.55)";
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.width, box.height);
  ctx.setLineDash([]);

  const ellipse = mascotHitboxEllipse(body);
  ctx.strokeStyle = "rgb(239, 68, 68)";
  ctx.fillStyle = "rgba(239, 68, 68, 0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(ellipse.cx, ellipse.cy, ellipse.rx, ellipse.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
