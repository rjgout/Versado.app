import { DORP_OBJECT_BY_ID } from "./catalog";
import { placementIsValid } from "./geometry";
import type { DorpLevel, DorpOwnedInstance, DorpWorldState, PlacedDorpObject, TileCoordinate } from "./types";

export function placedObjects(world: Pick<DorpWorldState, "instances">): PlacedDorpObject[] {
  return world.instances.flatMap((instance) => instance.position ? [{ ...instance.position, instanceId: instance.instanceId, objectId: instance.objectId, level: instance.level }] : []);
}

export function availableInstance(world: Pick<DorpWorldState, "instances">, objectId: string): DorpOwnedInstance | undefined {
  return world.instances.find((instance) => instance.objectId === objectId && instance.position === null);
}

export function placeOwnedInstance(instances: readonly DorpOwnedInstance[], instanceId: string, position: TileCoordinate): DorpOwnedInstance[] {
  return instances.map((instance) => instance.instanceId === instanceId ? { ...instance, position } : instance);
}

export function storeOwnedInstance(instances: readonly DorpOwnedInstance[], instanceId: string): DorpOwnedInstance[] {
  return instances.map((instance) => instance.instanceId === instanceId ? { ...instance, position: null } : instance);
}

export function levelOwnedInstance(instances: readonly DorpOwnedInstance[], instanceId: string, level: DorpLevel): DorpOwnedInstance[] {
  return instances.map((instance) => instance.instanceId === instanceId ? { ...instance, level } : instance);
}

export function reconcileInstancesForRadius(instances: readonly DorpOwnedInstance[], radius: number) {
  const accepted: PlacedDorpObject[] = [];
  let storedCount = 0;
  const next = instances.map((instance) => {
    if (!instance.position) return instance;
    const candidate = { ...instance.position, instanceId: instance.instanceId, objectId: instance.objectId, level: instance.level };
    if (placementIsValid(candidate, accepted, radius)) {
      accepted.push(candidate);
      return instance;
    }
    storedCount += 1;
    return { ...instance, position: null };
  });
  return { instances: next, storedCount };
}

export function ownershipIsValid(instances: readonly DorpOwnedInstance[]): boolean {
  const counts = new Map<string, number>();
  const ids = new Set<string>();
  for (const instance of instances) {
    const definition = DORP_OBJECT_BY_ID.get(instance.objectId);
    if (!definition || ids.has(instance.instanceId)) return false;
    ids.add(instance.instanceId);
    const count = (counts.get(instance.objectId) ?? 0) + 1;
    counts.set(instance.objectId, count);
    if (count > definition.maxInstances || instance.level < 1 || instance.level > definition.maxLevel) return false;
  }
  return true;
}
