import assetManifest from "./work/metadata/asset-manifest.json";
import publicCatalog from "./work/catalog/public-object-catalog.json";
import type { DorpAssetRegistration, DorpCategory, DorpLevel, DorpObjectDefinition, DorpObjectKind } from "./types";

type WorkAsset = (typeof assetManifest.assets)[number];
type WorkObject = (typeof publicCatalog.objects)[number];

const PUBLIC_ASSET_ROOT = "/versado-dorp-bom-v1/";
const inventoryKinds = new Set(["building", "landmark", "prop", "nature"]);

function categoryFor(kind: DorpObjectKind): DorpCategory {
  if (kind === "building") return "Gebouwen";
  if (kind === "landmark") return "Bijzondere gebouwen";
  if (kind === "nature") return "Natuur";
  return "Decoraties";
}

function isInventoryObject(object: WorkObject): object is WorkObject & { kind: DorpObjectKind; pilotAssets: string[] } {
  return inventoryKinds.has(object.kind) && Array.isArray(object.pilotAssets) && object.pilotAssets.length > 0;
}

export const DORP_ASSETS: readonly DorpAssetRegistration[] = assetManifest.assets.map((asset: WorkAsset) => ({
  assetId: asset.assetId,
  objectId: asset.objectId,
  level: asset.level as DorpLevel,
  path: `${PUBLIC_ASSET_ROOT}${asset.runtimePreview.path}`,
  anchor: [asset.anchor.normalized[0], asset.anchor.normalized[1]],
  // De Work-schaal is uitgedrukt ten opzichte van het mastercanvas, niet de 512px-runtimepreview.
  worldSize: [asset.master.pixels[0] * asset.suggestedWorldScale, asset.master.pixels[1] * asset.suggestedWorldScale] as const,
}));

export const DORP_OBJECTS: readonly DorpObjectDefinition[] = publicCatalog.objects
  .filter(isInventoryObject)
  .map((object) => {
    const availableLevels = DORP_ASSETS.filter((asset) => asset.objectId === object.id).map((asset) => asset.level);
    return {
      id: object.id,
      name: object.name,
      kind: object.kind,
      category: categoryFor(object.kind),
      footprint: [object.footprint[0], object.footprint[1]] as const,
      // De tempel heeft in deze levering alleen L1; niet-bestaande niveaus worden niet gesimuleerd.
      maxLevel: Math.max(...availableLevels) as DorpLevel,
      assetIds: object.pilotAssets,
    };
  });

export const DORP_OBJECT_BY_ID = new Map(DORP_OBJECTS.map((object) => [object.id, object]));
export const DORP_ASSET_BY_ID = new Map(DORP_ASSETS.map((asset) => [asset.assetId, asset]));

export function assetForObject(objectId: string, level: number): DorpAssetRegistration | undefined {
  return DORP_ASSETS.find((asset) => asset.objectId === objectId && asset.level === level);
}

export const DORP_TERRAIN_ASSETS = {
  grass: `${PUBLIC_ASSET_ROOT}assets/terrain/terrain-grass.webp`,
  dryGrass: `${PUBLIC_ASSET_ROOT}assets/terrain/terrain-dry-grass.webp`,
  flowerGrass: `${PUBLIC_ASSET_ROOT}assets/terrain/terrain-flower-grass.webp`,
  sand: `${PUBLIC_ASSET_ROOT}assets/terrain/terrain-sand.webp`,
  pathStraight: `${PUBLIC_ASSET_ROOT}assets/terrain/terrain-path-straight.webp`,
  pathCorner: `${PUBLIC_ASSET_ROOT}assets/terrain/terrain-path-corner.webp`,
} as const;

export const DORP_FOREST_ASSETS = [
  `${PUBLIC_ASSET_ROOT}assets/forest/forest-strip.webp`,
  `${PUBLIC_ASSET_ROOT}assets/forest/forest-corner.webp`,
  `${PUBLIC_ASSET_ROOT}assets/forest/forest-cap.webp`,
  `${PUBLIC_ASSET_ROOT}assets/forest/forest-dense.webp`,
] as const;

export const DORP_RESIDENTS = [
  { objectId: "vd-c001", characterId: "nephi", name: "Nephi", description: "Een vastberaden schriftkenner en bouwer.", asset: `${PUBLIC_ASSET_ROOT}assets/characters/resident-nephi.webp`, u: -1, v: 0 },
  { objectId: "vd-c002", characterId: "sariah", name: "Sariah", description: "Een wijze en moedige moeder in het verzameldorp.", asset: `${PUBLIC_ASSET_ROOT}assets/characters/resident-sariah.webp`, u: 1, v: 0 },
  { objectId: "vd-c013", characterId: "ammon-missionary", name: "Ammon, zoon van Mosiah", description: "Een toegewijde zendeling die anderen dient.", asset: `${PUBLIC_ASSET_ROOT}assets/characters/resident-ammon.webp`, u: 0, v: 2 },
  { objectId: "vd-c003", characterId: "lehi", name: "Lehi", description: "Een profeet en vader die zijn gezin leidt.", asset: `${PUBLIC_ASSET_ROOT}assets/characters/resident-lehi.webp`, u: 2, v: 2 },
] as const;
