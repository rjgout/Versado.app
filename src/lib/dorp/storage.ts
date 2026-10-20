import { DORP_OBJECTS, DORP_OBJECT_BY_ID } from "./catalog";
import { radiusForPhase } from "./geometry";
import { ownershipIsValid, reconcileInstancesForRadius } from "./ownership";
import { normalizePaths } from "./paths";
import { DORP_STORAGE_VERSION, type DorpLevel, type DorpOwnedInstance, type DorpWorldState, type TileCoordinate } from "./types";

export const DORP_STORAGE_KEY = `versado-dorp-prototype-v${DORP_STORAGE_VERSION}`;
export const DORP_LEGACY_STORAGE_KEYS = ["versado-dorp-prototype-v2", "versado-dorp-prototype-v1"] as const;

// Oude IDs blijven geldig; nieuwe werelden hebben geen geplaatste fixtures.
const legacyFixtureIdentities = new Map<string, { instanceId: string; level: DorpLevel }>([
  ["vd-b001", { instanceId: "fixture-family", level: 1 }],
  ["vd-b002", { instanceId: "fixture-scribe", level: 2 }],
  ["vd-b003", { instanceId: "fixture-assembly", level: 3 }],
  ["vd-p003", { instanceId: "fixture-well", level: 1 }],
  ["vd-n001", { instanceId: "fixture-tree", level: 1 }],
]);

function createPrototypeRights(): DorpOwnedInstance[] {
  return DORP_OBJECTS.flatMap((definition) => {
    const fixture = legacyFixtureIdentities.get(definition.id);
    const fixtureCount = definition.repeatable ? Math.min(2, definition.maxInstances) : 1;
    return Array.from({ length: fixtureCount }, (_, index): DorpOwnedInstance => ({
      instanceId: index === 0 && fixture ? fixture.instanceId : `fixture-${definition.id}-${index + 1}`,
      objectId: definition.id,
      level: index === 0 && fixture ? fixture.level : 1,
      position: null,
    }));
  });
}

export const DEFAULT_DORP_STATE: DorpWorldState = {
  version: DORP_STORAGE_VERSION,
  phase: 0,
  instances: createPrototypeRights(),
  paths: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePosition(value: unknown): TileCoordinate | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !Number.isInteger(value.u) || !Number.isInteger(value.v)) return undefined;
  return { u: value.u as number, v: value.v as number };
}

function parseOwnedInstance(value: unknown): DorpOwnedInstance | null {
  if (!isRecord(value) || typeof value.instanceId !== "string" || typeof value.objectId !== "string" || !Number.isInteger(value.level)) return null;
  const definition = DORP_OBJECT_BY_ID.get(value.objectId);
  const level = value.level as number;
  const position = parsePosition(value.position);
  if (!definition || position === undefined || level < 1 || level > definition.maxLevel) return null;
  return { instanceId: value.instanceId, objectId: value.objectId, level: level as DorpLevel, position };
}

export function parseDorpState(raw: string | null): DorpWorldState {
  if (!raw) return structuredClone(DEFAULT_DORP_STATE);
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || (value.version !== DORP_STORAGE_VERSION && value.version !== 2) || !Number.isInteger(value.phase) || !Array.isArray(value.instances) || !Array.isArray(value.paths)) {
      return structuredClone(DEFAULT_DORP_STATE);
    }
    const phase = Math.max(0, Math.min(16, value.phase as number));
    let instances = value.instances.map(parseOwnedInstance).filter((instance): instance is DorpOwnedInstance => instance !== null);
    if (value.version === 2) {
      // Alleen nieuwe bewonerrechten toevoegen; oude IDs, levels en indeling blijven intact.
      const missing = DEFAULT_DORP_STATE.instances.filter((fixture) => DORP_OBJECT_BY_ID.get(fixture.objectId)?.kind === "resident" && !instances.some((item) => item.instanceId === fixture.instanceId));
      instances = [...instances, ...structuredClone(missing)];
    }
    const completeRights = instances.length === DEFAULT_DORP_STATE.instances.length && DEFAULT_DORP_STATE.instances.every((fixture) => instances.some((instance) => instance.instanceId === fixture.instanceId && instance.objectId === fixture.objectId));
    if (!completeRights || !ownershipIsValid(instances)) return structuredClone(DEFAULT_DORP_STATE);
    const reconciled = reconcileInstancesForRadius(instances, radiusForPhase(phase));
    const paths = normalizePaths(value.paths.filter(isRecord).map((tile) => ({ u: tile.u as number, v: tile.v as number })), radiusForPhase(phase));
    return { version: DORP_STORAGE_VERSION, phase, instances: reconciled.instances, paths };
  } catch {
    return structuredClone(DEFAULT_DORP_STATE);
  }
}

export function serializeDorpState(state: DorpWorldState): string {
  return JSON.stringify(state);
}
