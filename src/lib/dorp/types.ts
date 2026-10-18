export const DORP_STORAGE_VERSION = 1 as const;

export type DorpObjectKind = "building" | "landmark" | "prop" | "nature";
export type DorpCategory = "Gebouwen" | "Bijzondere gebouwen" | "Decoraties" | "Natuur";
export type DorpLevel = 1 | 2 | 3;

export type DorpObjectDefinition = {
  id: string;
  name: string;
  kind: DorpObjectKind;
  category: DorpCategory;
  footprint: readonly [number, number];
  maxLevel: DorpLevel;
  assetIds: readonly string[];
};

export type DorpAssetRegistration = {
  assetId: string;
  objectId: string;
  level: DorpLevel;
  path: string;
  anchor: readonly [number, number];
  worldSize: readonly [number, number];
};

export type PlacedDorpObject = {
  instanceId: string;
  objectId: string;
  level: DorpLevel;
  u: number;
  v: number;
};

export type DorpWorldState = {
  version: typeof DORP_STORAGE_VERSION;
  phase: number;
  objects: PlacedDorpObject[];
};

export type TileCoordinate = { u: number; v: number };
