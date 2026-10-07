import type { PersonalMascotCharacter } from "@/lib/mascots";
import { quickMissionaryMascotSprite } from "@/lib/snelleZendeling/assets";
import { rockRenderRect, wallRenderRect } from "@/lib/snelleZendeling/obstacles";
import { MASCOT_RENDER_SIZE, MASCOT_X, WORLD_HEIGHT, WORLD_WIDTH, type ObstaclePair } from "@/lib/snelleZendeling/gameplay";

// Het tekenen van de wereld voor de gezamenlijke run: dezelfde lagen en
// obstakels als solo (RunClient.tsx), plus de mascotten van de andere spelers
// als doorzichtige "ghosts". Ghosts zijn alleen beeld: ze doen niet mee aan
// botsingen en geven geen score.

const ASSET_BASE = "/games/snelle-zendeling";
const LAYERS = [
  ["background-sky.png", 0],
  ["background-hills.png", 0.12],
  ["background-city.png", 0.2],
  ["background-landscape.png", 0.35],
] as const;

export const GHOST_ALPHA = 0.4;

export type SceneImages = Record<string, HTMLImageElement>;

export function loadSceneImages(characters: PersonalMascotCharacter[]): SceneImages {
  const names = [
    ...LAYERS.map(([name]) => name),
    "foreground-ground.png",
    "obstacle-wall-long.png",
    "obstacle-rock-long.png",
    ...characters.flatMap((character) => [quickMissionaryMascotSprite(character, "glide"), quickMissionaryMascotSprite(character, "boost")]),
  ];
  const images: SceneImages = {};
  for (const name of names) {
    const img = new Image();
    img.src = `${ASSET_BASE}/${name}`;
    images[name] = img;
  }
  return images;
}

export interface SceneMascot {
  character: PersonalMascotCharacter;
  y: number;
  boost: boolean;
  alpha?: number;
}

export function drawScene(ctx: CanvasRenderingContext2D, images: SceneImages, scene: { offset: number; pairs: ObstaclePair[]; ghosts: SceneMascot[]; me: SceneMascot | null }): void {
  ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  const drawRepeating = (name: string, factor: number, maxHeight?: number) => {
    const img = images[name];
    if (!img?.complete || !img.naturalWidth) return;
    const targetHeight = maxHeight ? WORLD_HEIGHT * maxHeight : WORLD_HEIGHT;
    const scale = maxHeight ? Math.max(WORLD_WIDTH / img.naturalWidth, targetHeight / img.naturalHeight) : Math.max(WORLD_WIDTH / img.naturalWidth, WORLD_HEIGHT / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    const offset = -((scene.offset * factor) % width);
    const y = WORLD_HEIGHT - height;
    for (let x = offset - width; x < WORLD_WIDTH + width; x += width - 1) ctx.drawImage(img, x, y, width, height);
  };
  for (const [name, factor] of LAYERS) drawRepeating(name, factor);
  drawRepeating("foreground-ground.png", 0.75, 0.08);
  const rock = images["obstacle-rock-long.png"];
  const wall = images["obstacle-wall-long.png"];
  for (const pair of scene.pairs) {
    if (rock?.complete && rock.naturalWidth) {
      const rect = rockRenderRect(pair, rock.naturalHeight);
      ctx.drawImage(rock, rect.x, rect.y, rect.width, rect.height);
    }
    if (wall?.complete && wall.naturalWidth) {
      const rect = wallRenderRect(pair, wall.naturalHeight);
      ctx.drawImage(wall, rect.x, rect.y, rect.width, rect.height);
    }
  }
  const drawMascot = (mascot: SceneMascot, alpha: number) => {
    const img = images[quickMissionaryMascotSprite(mascot.character, mascot.boost ? "boost" : "glide")];
    if (!img?.complete || !img.naturalWidth) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, MASCOT_X, mascot.y, MASCOT_RENDER_SIZE, MASCOT_RENDER_SIZE);
    ctx.globalAlpha = 1;
  };
  for (const ghost of scene.ghosts) drawMascot(ghost, ghost.alpha ?? GHOST_ALPHA);
  if (scene.me) drawMascot(scene.me, scene.me.alpha ?? 1);
}
