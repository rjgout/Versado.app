import assetManifest from "./work/metadata/asset-manifest.json";
import fix01Manifest from "./work/metadata/fix-01-runtime-manifest.json";
import publicCatalog from "./work/catalog/public-object-catalog.json";
import type { DorpAssetRegistration, DorpCategory, DorpLevel, DorpObjectDefinition, DorpObjectKind } from "./types";

type WorkAsset = (typeof assetManifest.assets)[number];
type FixAsset = (typeof fix01Manifest.assets)[number];
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

const fixAssetIds = new Set(fix01Manifest.assets.map((asset) => asset.assetId));
const originalAssets: readonly DorpAssetRegistration[] = assetManifest.assets.filter((asset) => !fixAssetIds.has(asset.assetId)).map((asset: WorkAsset) => ({
  assetId: asset.assetId,
  objectId: asset.objectId,
  level: asset.level as DorpLevel,
  path: `${PUBLIC_ASSET_ROOT}${asset.runtimePreview.path}`,
  anchor: [asset.anchor.normalized[0], asset.anchor.normalized[1]],
  // De Work-schaal is uitgedrukt ten opzichte van het mastercanvas, niet de 512px-runtimepreview.
  worldSize: [asset.master.pixels[0] * asset.suggestedWorldScale, asset.master.pixels[1] * asset.suggestedWorldScale] as const,
}));

const fixAssets: readonly DorpAssetRegistration[] = fix01Manifest.assets.map((asset: FixAsset) => ({
  assetId: asset.assetId,
  objectId: asset.objectId,
  level: asset.level as DorpLevel,
  path: `${PUBLIC_ASSET_ROOT}${asset.path}`,
  anchor: [asset.anchor[0], asset.anchor[1]] as const,
  worldSize: [asset.worldSize[0], asset.worldSize[1]] as const,
}));

export const DORP_ASSETS: readonly DorpAssetRegistration[] = [...originalAssets, ...fixAssets];

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
      maxInstances: object.maxInstances ?? 1,
      repeatable: (object.maxInstances ?? 1) > 1,
      assetIds: object.pilotAssets,
    };
  });

// Bewoners gebruiken hun bestaande, gevalideerde Work-registratie als één-celanker.
for (const asset of DORP_ASSETS.filter((a) => a.assetId.startsWith("resident-"))) {
  const source = publicCatalog.objects.find((o) => o.id === asset.objectId);
  (DORP_OBJECTS as DorpObjectDefinition[]).push({
    id: asset.objectId, name: source?.name ?? asset.objectId, kind: "resident", category: "Bewoners",
    footprint: [1, 1], maxLevel: 1, maxInstances: 1, repeatable: false, assetIds: [asset.assetId],
  });
}

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

export const DORP_TERRAIN_RUNTIME_BY_ID = new Map(
  fix01Manifest.assets
    .filter((asset) => asset.category === "terrain")
    .map((asset) => [asset.assetId, {
      full: `${PUBLIC_ASSET_ROOT}${asset.path}`,
      half: asset.lods.find((lod) => lod.pixels[0] === 64)?.path ? `${PUBLIC_ASSET_ROOT}${asset.lods.find((lod) => lod.pixels[0] === 64)!.path}` : `${PUBLIC_ASSET_ROOT}${asset.path}`,
      quarter: asset.lods.find((lod) => lod.pixels[0] === 32)?.path ? `${PUBLIC_ASSET_ROOT}${asset.lods.find((lod) => lod.pixels[0] === 32)!.path}` : `${PUBLIC_ASSET_ROOT}${asset.path}`,
    }]),
);

export const DORP_TERRAIN_RUNTIME_PATHS = [...DORP_TERRAIN_RUNTIME_BY_ID.values()].flatMap((runtime) => [runtime.full, runtime.half, runtime.quarter]);

export const DORP_FOREST_ASSETS = [
  { role: "strip", variants: ["forest-strip", "forest-strip-v2"] },
  { role: "corner", variants: ["forest-corner", "forest-corner-v2"] },
  { role: "cap", variants: ["forest-cap", "forest-cap-v2"] },
  { role: "dense", variants: ["forest-dense", "forest-dense-v2"] },
] as const;

export function forestAssetFor(index: number, u: number, v: number): DorpAssetRegistration {
  const group = DORP_FOREST_ASSETS[index % DORP_FOREST_ASSETS.length];
  const variantIndex = Math.abs((u * 73_856_093) ^ (v * 19_349_663) ^ index) % group.variants.length;
  return DORP_ASSET_BY_ID.get(group.variants[variantIndex])!;
}

export const DORP_RESIDENTS = [
  { objectId: "vd-c001", characterId: "nephi", name: "Nephi", description: "Een vastberaden schriftkenner en bouwer.", assetId: "resident-nephi", u: -1, v: 0 },
  { objectId: "vd-c002", characterId: "sariah", name: "Sariah", description: "Een wijze en moedige moeder in het verzameldorp.", assetId: "resident-sariah", u: 1, v: 0 },
  { objectId: "vd-c013", characterId: "ammon-missionary", name: "Ammon, zoon van Mosiah", description: "Een toegewijde zendeling die anderen dient.", assetId: "resident-ammon", u: 0, v: 2 },
  { objectId: "vd-c003", characterId: "lehi", name: "Lehi", description: "Een profeet en vader die zijn gezin leidt.", assetId: "resident-lehi", u: 2, v: 2 },
  { objectId: "vd-c014", characterId: "abish", name: "Abish", description: "Een gelovige Lamanitische vrouw die anderen bijeenriep.", assetId: "resident-abish", u: 3, v: -1 },
] as const;

export function residentAssetFor(assetId: string): DorpAssetRegistration {
  return DORP_ASSET_BY_ID.get(assetId)!;
}
