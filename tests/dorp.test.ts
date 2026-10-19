import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createRenderScheduler, fitCameraToRadius, screenToWorld, zoomCameraAroundPoint } from "../src/lib/dorp/camera";
import { DORP_ASSETS, DORP_FOREST_ASSETS, DORP_OBJECT_BY_ID, DORP_OBJECTS, DORP_RESIDENTS, assetForObject } from "../src/lib/dorp/catalog";
import { canAccessDorpPrototype, dorpPrototypeEnabled } from "../src/lib/dorp/access";
import {
  EXPANSION_COUNT,
  MAX_RADIUS,
  PROTOTYPE_PHASES,
  START_RADIUS,
  buildableTileCount,
  chapterThresholdForPhase,
  footprintTiles,
  isTileBuildable,
  placementIsValid,
  projectedWorldBounds,
  radiusForPhase,
  suggestPlacement,
} from "../src/lib/dorp/geometry";
import { availableInstance, levelOwnedInstance, ownershipIsValid, placeOwnedInstance, placedObjects, reconcileInstancesForRadius, storeOwnedInstance } from "../src/lib/dorp/ownership";
import { pathConnectivity, pathVariantForMask } from "../src/lib/dorp/paths";
import { DEFAULT_DORP_STATE, DORP_STORAGE_KEY, parseDorpState, serializeDorpState } from "../src/lib/dorp/storage";
import type { DorpOwnedInstance, PlacedDorpObject } from "../src/lib/dorp/types";
import { shellModeForRoute } from "../src/lib/focusMode";

test("kaart groeit in zestien stappen exact van R8 naar R62", () => {
  const radii = Array.from({ length: EXPANSION_COUNT + 1 }, (_, phase) => radiusForPhase(phase));
  assert.deepEqual(radii, [8, 11, 14, 18, 21, 24, 28, 31, 35, 38, 41, 45, 48, 51, 55, 58, 62]);
  assert.equal(START_RADIUS, 8);
  assert.equal(MAX_RADIUS, 62);
  assert.equal(buildableTileCount(8), 197);
  assert.equal(buildableTileCount(14), 613);
  assert.equal(buildableTileCount(62), 12_061);
  assert.equal(radii.slice(1).filter((radius, index) => radius - radii[index] === 3).length, 10);
  assert.equal(radii.slice(1).filter((radius, index) => radius - radii[index] === 4).length, 6);
  assert.deepEqual(PROTOTYPE_PHASES.map((phase) => phase.radius), [8, 11, 14, 35, 62]);
});

test("hoofdstukdrempels volgen de productformule zonder voortgang te activeren", () => {
  assert.deepEqual(Array.from({ length: 16 }, (_, index) => chapterThresholdForPhase(index + 1)), [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 239]);
});

test("footprints bepalen plaatsing, overlap en de fysieke tempelgrens", () => {
  const family: PlacedDorpObject = { instanceId: "a", objectId: "vd-b001", level: 1, u: -1, v: -1 };
  assert.equal(placementIsValid(family, [], 8), true);
  assert.ok(suggestPlacement("vd-b001", [], 8), "een klein huis past op R8");
  assert.equal(placementIsValid({ instanceId: "b", objectId: "vd-b002", u: 0, v: 0 }, [family], 8), false);
  assert.equal(placementIsValid({ ...family, u: 2, v: 2 }, [family], 8), true, "verplaatsen negeert de eigen oude footprint");
  assert.equal(footprintTiles(0, 0, [12, 12]).length, 144);
  assert.equal(suggestPlacement("vd-l001", [], 8), null, "de tempel past fysiek niet op R8");
  assert.ok(suggestPlacement("vd-l001", [], 14), "R14 blijft als expliciet tempeltestniveau beschikbaar");
  assert.equal(isTileBuildable(8, 0, 8), true);
  assert.equal(isTileBuildable(8, 1, 8), false);
});

test("werkelijke geprojecteerde wereldgrenzen sturen een veilige, compacte fit", () => {
  const bounds = projectedWorldBounds(8);
  const insets = { top: 84, right: 12, bottom: 132, left: 12 };
  const camera = fitCameraToRadius(390, 844, 8, insets);
  const project = (x: number, y: number) => ({ x: 195 + (x - camera.x) * camera.zoom, y: 422 + (y - camera.y) * camera.zoom });
  const topLeft = project(bounds.minX, bounds.minY);
  const bottomRight = project(bounds.maxX, bounds.maxY);
  assert.ok(topLeft.x >= insets.left - 0.001);
  assert.ok(topLeft.y >= insets.top - 0.001);
  assert.ok(bottomRight.x <= 390 - insets.right + 0.001);
  assert.ok(bottomRight.y <= 844 - insets.bottom + 0.001);
  assert.ok(camera.zoom > fitCameraToRadius(390, 844, 62, insets).zoom, "de huidige R8-kaart wordt niet zo klein als de maximale wereld");
});

test("cursorgerichte zoom behoudt het wereldpunt onder de aanwijzer", () => {
  const camera = { x: 25, y: -10, zoom: 0.5 };
  const before = screenToWorld(camera, 390, 844, 70, 220);
  const zoomed = zoomCameraAroundPoint(camera, 390, 844, 70, 220, 0.9);
  assert.deepEqual(screenToWorld(zoomed, 390, 844, 70, 220), before);
});

test("renderplanner tekent op het volgende frame en voegt dubbele aanvragen samen", () => {
  const callbacks: FrameRequestCallback[] = [];
  let draws = 0;
  const scheduler = createRenderScheduler((callback) => { callbacks.push(callback); return callbacks.length; }, () => undefined, () => { draws += 1; });
  scheduler.request(); scheduler.request();
  assert.equal(callbacks.length, 1);
  callbacks[0](0);
  assert.equal(draws, 1);
  scheduler.request();
  assert.equal(callbacks.length, 2);
});

test("eigendom onderscheidt unieke en herhaalbare exemplaarrechten", () => {
  assert.equal(ownershipIsValid(DEFAULT_DORP_STATE.instances), true);
  for (const definition of DORP_OBJECTS.filter((object) => !object.repeatable)) {
    assert.equal(DEFAULT_DORP_STATE.instances.filter((instance) => instance.objectId === definition.id).length, 1, definition.id);
  }
  const repeatable = DORP_OBJECTS.find((object) => object.repeatable)!;
  assert.ok(DEFAULT_DORP_STATE.instances.filter((instance) => instance.objectId === repeatable.id).length > 1);
  assert.equal(ownershipIsValid([...DEFAULT_DORP_STATE.instances, { ...DEFAULT_DORP_STATE.instances.find((instance) => instance.objectId === "vd-b001")!, instanceId: "dubbel" }]), false);
});

test("terugnemen en herplaatsen behouden instance-ID en upgradeniveau", () => {
  const original = DEFAULT_DORP_STATE.instances.find((instance) => instance.objectId === "vd-b001")!;
  let instances = levelOwnedInstance(DEFAULT_DORP_STATE.instances, original.instanceId, 3);
  instances = storeOwnedInstance(instances, original.instanceId);
  const stored = instances.find((instance) => instance.instanceId === original.instanceId)!;
  assert.equal(stored.position, null);
  assert.equal(stored.level, 3);
  instances = placeOwnedInstance(instances, original.instanceId, { u: 0, v: 0 });
  const replaced = instances.find((instance) => instance.instanceId === original.instanceId)!;
  assert.equal(replaced.level, 3);
  assert.deepEqual(replaced.position, { u: 0, v: 0 });
  assert.equal(availableInstance({ instances }, "vd-b001"), undefined, "een uniek geplaatst gebouw kan niet opnieuw worden gekozen");
});

test("kaartverkleining bergt buitenliggende objecten deterministisch op zonder niveauverlies", () => {
  const instance: DorpOwnedInstance = { instanceId: "ver", objectId: "vd-b001", level: 3, position: { u: 20, v: 20 } };
  const result = reconcileInstancesForRadius([instance], 8);
  assert.equal(result.storedCount, 1);
  assert.deepEqual(result.instances[0], { ...instance, position: null });
});

test("opslag v2 herlaadt, verwerpt v1 en saneert kaartverkleining", () => {
  assert.match(DORP_STORAGE_KEY, /v2$/);
  assert.deepEqual(parseDorpState(serializeDorpState(DEFAULT_DORP_STATE)), DEFAULT_DORP_STATE);
  assert.deepEqual(parseDorpState(JSON.stringify({ version: 1, phase: 0, objects: [] })), DEFAULT_DORP_STATE);
  const far = { ...DEFAULT_DORP_STATE.instances.find((instance) => instance.objectId === "vd-b001")!, level: 3 as const, position: { u: 20, v: 20 } };
  const instances = DEFAULT_DORP_STATE.instances.map((instance) => instance.instanceId === far.instanceId ? far : instance);
  const parsed = parseDorpState(JSON.stringify({ version: 2, phase: 0, instances, paths: [{ u: 30, v: 30 }] }));
  const stored = parsed.instances.find((instance) => instance.instanceId === far.instanceId)!;
  assert.equal(stored.level, 3);
  assert.equal(stored.position, null);
  assert.deepEqual(parsed.paths, []);
  assert.equal(placedObjects(parsed).some((object) => object.instanceId === far.instanceId), false);
});

test("padconnectiviteit kiest alle logische basisvarianten zonder gebouwobjecten", () => {
  const center = { u: 0, v: 0 };
  assert.equal(pathVariantForMask(pathConnectivity(center, [center])), "isolated");
  assert.equal(pathVariantForMask(pathConnectivity(center, [center, { u: 1, v: 0 }])), "end");
  assert.equal(pathVariantForMask(pathConnectivity(center, [center, { u: -1, v: 0 }, { u: 1, v: 0 }])), "straight");
  assert.equal(pathVariantForMask(pathConnectivity(center, [center, { u: 1, v: 0 }, { u: 0, v: 1 }])), "corner");
  assert.equal(pathVariantForMask(pathConnectivity(center, [center, { u: -1, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }])), "tee");
  assert.equal(pathVariantForMask(15), "cross");
});

test("upgrades houden footprint en positie gelijk en niet-bestaande niveaus ontbreken", () => {
  for (const id of ["vd-b001", "vd-b002", "vd-b003"]) {
    const definition = DORP_OBJECT_BY_ID.get(id)!;
    assert.equal(definition.maxLevel, 3);
    assert.deepEqual(assetForObject(id, 1)?.objectId, id);
    assert.deepEqual(assetForObject(id, 2)?.objectId, id);
    assert.deepEqual(assetForObject(id, 3)?.objectId, id);
    assert.equal(new Set([1, 2, 3].map(() => definition.footprint.join("x"))).size, 1);
  }
  assert.equal(DORP_OBJECT_BY_ID.get("vd-l001")?.maxLevel, 1);
  assert.equal(assetForObject("vd-l001", 2), undefined);
});

test("pilotcatalogus gebruikt bestaande Work-assets, metadata en canonieke bewoners", () => {
  assert.ok(DORP_OBJECTS.length >= 10);
  assert.deepEqual(DORP_OBJECT_BY_ID.get("vd-b001")?.footprint, [3, 3]);
  assert.equal(DORP_OBJECT_BY_ID.get("vd-b001")?.maxInstances, 1);
  assert.equal(DORP_OBJECT_BY_ID.get("vd-p003")?.repeatable, true);
  assert.deepEqual(DORP_OBJECT_BY_ID.get("vd-l001")?.footprint, [12, 12]);
  for (const asset of DORP_ASSETS) {
    assert.match(asset.path, /^\/versado-dorp-bom-v1\/assets\//);
    assert.ok(existsSync(`${process.cwd()}/public${asset.path}`), asset.path);
    assert.ok(asset.anchor[0] >= 0 && asset.anchor[0] <= 1);
    assert.ok(asset.anchor[1] >= 0 && asset.anchor[1] <= 1);
  }
  assert.ok(DORP_FOREST_ASSETS.every((group) => group.variants.length > 0));
  assert.deepEqual(DORP_RESIDENTS.map((resident) => resident.characterId), ["nephi", "sariah", "ammon-missionary", "lehi"]);
});

test("camera-events vragen frames aan en pinch kan nooit als tap eindigen", () => {
  const client = readFileSync(`${process.cwd()}/src/components/dorp/DorpPrototypeClient.tsx`, "utf8");
  assert.doesNotMatch(client, /setInterval\s*\(/);
  assert.match(client, /requestDrawRef\.current\(\)/);
  assert.match(client, /hadMultiplePointers/);
  assert.match(client, /POINTER_MOVE_THRESHOLD/);
  assert.match(client, /zoomCameraAroundPoint/);
});

test("ontwikkelroute vereist featureflag plus admin en lekt geen privémapping", () => {
  assert.equal(dorpPrototypeEnabled({ NODE_ENV: "test", VERSADO_DORP_PROTOTYPE_ENABLED: "true" }), true);
  assert.equal(dorpPrototypeEnabled({ NODE_ENV: "test", VERSADO_DORP_PROTOTYPE_ENABLED: "1" }), false);
  assert.equal(canAccessDorpPrototype({ enabled: true, authenticated: true, isAdmin: true }), true);
  assert.equal(canAccessDorpPrototype({ enabled: true, authenticated: true, isAdmin: false }), false);
  assert.equal(canAccessDorpPrototype({ enabled: false, authenticated: true, isAdmin: true }), false);

  const client = readFileSync(`${process.cwd()}/src/components/dorp/DorpPrototypeClient.tsx`, "utf8");
  const page = readFileSync(`${process.cwd()}/src/app/dev/versado-dorp/page.tsx`, "utf8");
  assert.doesNotMatch(client, /chapter-rewards|server-only|hoofdstukmapping/i);
  assert.doesNotMatch(page, /LOCAL_QA|bypass/i);
  assert.match(page, /VERSADO_DORP_PROTOTYPE_ENABLED|dorpPrototypeEnabled/);
  assert.match(page, /user\.isAdmin/);
  assert.match(client, /aria-label="Testmenu"/);
  assert.equal(shellModeForRoute("/dev/versado-dorp"), "focus");
  assert.equal(existsSync(`${process.cwd()}/public/versado-dorp-bom-v1/server-only`), false);
});
