import { isoToWorld, TILE_HEIGHT } from "./geometry";
import type { DorpAssetRegistration, DorpObjectDefinition, TileCoordinate } from "./types";

// Visuele contactpunten in de bestaande runtime-assets. Geen wijziging van
// opgeslagen coördinaten, worldSize, footprint, collision of eigendom.
const groundCenters: Readonly<Record<string, readonly [number, number]>> = {
  "vd-p002": [238 / 512, 189 / 256], // vier bankpoten; niet de bbox van de rug
  "vd-p003": [259 / 512, 280 / 341], // midden van de ronde putvoet
  "vd-p006": [224 / 512, 303 / 341], // stenen voet, niet de hangende lantaarn
};
export function registeredSprite(definition: DorpObjectDefinition, asset: DorpAssetRegistration, tile: TileCoordinate) {
  const center = groundCenters[definition.id];
  if (center || definition.kind === "resident") {
    return { point: isoToWorld(tile.u + (definition.footprint[0] - 1) / 2, tile.v + (definition.footprint[1] - 1) / 2), anchor: center ?? asset.anchor };
  }
  const point = isoToWorld(tile.u + definition.footprint[0] - 1, tile.v + definition.footprint[1] - 1);
  // De metadata noemt de voorste footprint-hoek, niet het midden van de laatste tegel.
  return { point: { x: point.x, y: point.y + (definition.kind === "building" || definition.kind === "landmark" ? TILE_HEIGHT / 2 : 0) }, anchor: asset.anchor };
}
