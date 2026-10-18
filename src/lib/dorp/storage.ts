import { DORP_OBJECT_BY_ID } from "./catalog";
import { placementIsValid, radiusForPhase } from "./geometry";
import { DORP_STORAGE_VERSION, type DorpLevel, type DorpWorldState, type PlacedDorpObject } from "./types";

export const DORP_STORAGE_KEY = `versado-dorp-prototype-v${DORP_STORAGE_VERSION}`;

export const DEFAULT_DORP_STATE: DorpWorldState = {
  version: DORP_STORAGE_VERSION,
  phase: 0,
  objects: [
    { instanceId: "fixture-family", objectId: "vd-b001", level: 1, u: -7, v: -5 },
    { instanceId: "fixture-scribe", objectId: "vd-b002", level: 2, u: 2, v: -5 },
    { instanceId: "fixture-assembly", objectId: "vd-b003", level: 3, u: -2, v: 3 },
    { instanceId: "fixture-well", objectId: "vd-p003", level: 1, u: 4, v: 1 },
    { instanceId: "fixture-tree", objectId: "vd-n001", level: 1, u: -7, v: 2 },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlacedObject(value: unknown): PlacedDorpObject | null {
  if (!isRecord(value) || typeof value.instanceId !== "string" || typeof value.objectId !== "string") return null;
  if (!Number.isInteger(value.u) || !Number.isInteger(value.v) || !Number.isInteger(value.level)) return null;
  const definition = DORP_OBJECT_BY_ID.get(value.objectId);
  const level = value.level as number;
  if (!definition || level < 1 || level > definition.maxLevel) return null;
  return { instanceId: value.instanceId, objectId: value.objectId, u: value.u as number, v: value.v as number, level: level as DorpLevel };
}

export function parseDorpState(raw: string | null): DorpWorldState {
  if (!raw) return structuredClone(DEFAULT_DORP_STATE);
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== DORP_STORAGE_VERSION || !Number.isInteger(value.phase) || !Array.isArray(value.objects)) {
      return structuredClone(DEFAULT_DORP_STATE);
    }
    const phase = Math.max(0, Math.min(16, value.phase as number));
    const objects: PlacedDorpObject[] = [];
    const ids = new Set<string>();
    for (const entry of value.objects) {
      const object = parsePlacedObject(entry);
      if (!object || ids.has(object.instanceId) || !placementIsValid(object, objects, radiusForPhase(phase))) continue;
      ids.add(object.instanceId);
      objects.push(object);
    }
    return { version: DORP_STORAGE_VERSION, phase, objects };
  } catch {
    return structuredClone(DEFAULT_DORP_STATE);
  }
}

export function serializeDorpState(state: DorpWorldState): string {
  return JSON.stringify(state);
}
