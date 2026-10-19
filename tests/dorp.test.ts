import { BOFM_CANONICAL_CONTENT_KEYS } from "../src/lib/dorp/growth";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  forestPlacements,
  isTileBuildable,
  placementIsValid,
  projectedWorldBounds,
  radiusForPhase,
  suggestPlacement,
} from "../src/lib/dorp/geometry";
import { availableInstance, levelOwnedInstance, ownershipIsValid, placeOwnedInstance, placedObjects, reconcileInstancesForRadius, storeOwnedInstance } from "../src/lib/dorp/ownership";
import { paintPathSegment, paintPathTiles, pathAssetIdForMask, pathConnectivity, pathConnectivityFromKeys, pathKey, pathVariantForMask } from "../src/lib/dorp/paths";
import { DEFAULT_DORP_STATE, DORP_STORAGE_KEY, parseDorpState, serializeDorpState } from "../src/lib/dorp/storage";
import { sandCornerLabel, sandTransitionMask, terrainAssetId, terrainBufferBounds } from "../src/lib/dorp/terrain";
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
  assert.equal(forestPlacements(8).length, 80);
  assert.equal(forestPlacements(14).length, 115);
  assert.equal(forestPlacements(62).length, 395);
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

test("opslag v3 herlaadt, migreert v2 en verwerpt v1 en saneert kaartverkleining", () => {
  assert.match(DORP_STORAGE_KEY, /v3$/);
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
  assert.equal(pathConnectivity(center, [center, { u: 1, v: 0 }]), 1, "+u is de gebakken SE-richting");
  assert.equal(pathConnectivity(center, [center, { u: 0, v: 1 }]), 2, "+v is de gebakken SW-richting");
  assert.equal(pathConnectivity(center, [center, { u: -1, v: 0 }]), 4, "-u is de gebakken NW-richting");
  assert.equal(pathConnectivity(center, [center, { u: 0, v: -1 }]), 8, "-v is de gebakken NE-richting");
  assert.equal(pathVariantForMask(pathConnectivity(center, [center, { u: 1, v: 0 }])), "end");
  assert.equal(pathVariantForMask(pathConnectivity(center, [center, { u: -1, v: 0 }, { u: 1, v: 0 }])), "straight");
  assert.equal(pathVariantForMask(pathConnectivity(center, [center, { u: 1, v: 0 }, { u: 0, v: 1 }])), "corner");
  assert.equal(pathVariantForMask(pathConnectivity(center, [center, { u: -1, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }])), "tee");
  assert.equal(pathVariantForMask(15), "cross");
  assert.deepEqual(Array.from({ length: 16 }, (_, mask) => pathAssetIdForMask(mask)), [
    "terrain-path-end-se", "terrain-path-end-se", "terrain-path-end-sw", "terrain-path-corner",
    "terrain-path-end-nw", "terrain-path-straight", "terrain-path-corner-sw-nw", "terrain-path-t-se-sw-nw",
    "terrain-path-end-ne", "terrain-path-corner-se-ne", "terrain-path-straight-sw-ne", "terrain-path-t-se-sw-ne",
    "terrain-path-corner-nw-ne", "terrain-path-t-se-nw-ne", "terrain-path-t-sw-nw-ne", "terrain-path-cross-se-sw-nw-ne",
  ]);
});

test("terrein gebruikt gedeelde zandhoeklabels en één native compositiebuffer", () => {
  for (let u = -2; u <= 7; u += 1) {
    for (let v = -7; v <= 2; v += 1) {
      const mask = sandTransitionMask(u, v);
      assert.equal(Boolean(mask & 2), sandCornerLabel(u + 1, v));
      assert.equal(Boolean(mask & 4), sandCornerLabel(u + 1, v + 1));
      assert.match(terrainAssetId(u, v), /^terrain-(grass|dry-grass|flower-grass|sand(?:-transition-m(?:0[1-9]|1[0-4]))?)$/);
    }
  }
  assert.equal(terrainAssetId(0, 0, 15), "terrain-path-cross-se-sw-nw-ne");
  const bounds = terrainBufferBounds(0.25, -0.5, 0.73, 390, 844);
  assert.ok(Number.isInteger(bounds.minX) && Number.isInteger(bounds.maxY));
  assert.ok(bounds.maxX - bounds.minX > 390 / 0.73);
});

test("upgrades houden footprint en positie gelijk en niet-bestaande niveaus ontbreken", () => {
  for (const id of ["vd-b001", "vd-b002", "vd-b003"]) {
    const definition = DORP_OBJECT_BY_ID.get(id)!;
    assert.equal(definition.maxLevel, 3);
    assert.deepEqual(assetForObject(id, 1)?.objectId, id);
    assert.deepEqual(assetForObject(id, 2)?.objectId, id);
    assert.deepEqual(assetForObject(id, 3)?.objectId, id);
    assert.equal(new Set([1, 2, 3].map((level) => assetForObject(id, level)!.anchor.join(","))).size, 1);
    assert.equal(new Set([1, 2, 3].map((level) => assetForObject(id, level)!.worldSize.join("x"))).size, 1);
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
  assert.ok(DORP_FOREST_ASSETS.every((group) => group.variants.length === 2));
  assert.deepEqual(DORP_RESIDENTS.map((resident) => resident.characterId), ["nephi", "sariah", "ammon-missionary", "lehi", "abish"]);
});

test("Fix-01 bevat exact 56 geldige veilige runtime-assets", () => {
  const manifest = JSON.parse(readFileSync(`${process.cwd()}/src/lib/dorp/work/metadata/fix-01-runtime-manifest.json`, "utf8")) as {
    assets: Array<{ assetId: string; objectId: string; footprint: [number, number]; path: string; sha256: string; lods: Array<{ path: string; sha256: string }>; anchor: [number, number]; worldSize: [number, number] }>;
  };
  assert.equal(manifest.assets.length, 56);
  assert.equal(new Set(manifest.assets.map((asset) => asset.assetId)).size, 56);
  for (const asset of manifest.assets) {
    const file = `${process.cwd()}/public/versado-dorp-bom-v1/${asset.path}`;
    assert.ok(existsSync(file), asset.path);
    assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), asset.sha256, asset.assetId);
    assert.ok(asset.anchor.every((value) => value >= 0 && value <= 1), asset.assetId);
    assert.ok(asset.worldSize.every((value) => value > 0), asset.assetId);
    for (const lod of asset.lods) {
      const lodFile = `${process.cwd()}/public/versado-dorp-bom-v1/${lod.path}`;
      assert.equal(createHash("sha256").update(readFileSync(lodFile)).digest("hex"), lod.sha256, lod.path);
    }
  }
  assert.equal(manifest.assets.flatMap((asset) => asset.lods).length, 66);
});

test("camera-events vragen frames aan en pinch kan nooit als tap eindigen", () => {
  const client = readFileSync(`${process.cwd()}/src/components/dorp/DorpPrototypeClient.tsx`, "utf8");
  assert.doesNotMatch(client, /setInterval\s*\(/);
  assert.match(client, /requestDrawRef\.current\(\)/);
  assert.match(client, /hadMultiplePointers/);
  assert.match(client, /POINTER_MOVE_THRESHOLD/);
  assert.match(client, /zoomCameraAroundPoint/);
  assert.match(client, /document\.createElement\("canvas"\)/);
  assert.match(client, /terrainCache\.scaledCanvas/);
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


test("penseel overgeslagen tegels blijft vierverbonden, begrensd en wisbaar", () => {
  const paths = paintPathSegment([], {u:0,v:0}, {u:5,v:5}, 8);
  const keys = new Set(paths.map(pathKey));
  assert.ok(paths.length > 6);
  for (const tile of paths) assert.ok(pathConnectivityFromKeys(tile, keys) !== 0);
  assert.deepEqual(paintPathTiles(paths, paths, 8, true), []);
  assert.deepEqual(paintPathTiles([], [{u:9,v:0},{u:.5,v:0}], 8), []);
});

test("paden hebben geen inventarislimiet en mogen onder gebouwen liggen", () => {
  const tiles = [];
  for(let u=-62;u<=62;u++)for(let v=-62;v<=62;v++)tiles.push({u,v});
  const paths = paintPathTiles([], tiles, 62);
  assert.equal(paths.length, 12061);
  assert.equal(paintPathTiles(paths, tiles, 62).length, 12061);
  const world = {...DEFAULT_DORP_STATE, paths};
  assert.deepEqual(world.instances, DEFAULT_DORP_STATE.instances);
});

test("v2 opslag behoudt oude eigendommen en krijgt vijf ongeplaatste bewoners", () => {
  const old = {...DEFAULT_DORP_STATE, version:2, instances:DEFAULT_DORP_STATE.instances.filter(i=>DORP_OBJECT_BY_ID.get(i.objectId)?.kind!=="resident")};
  const restored=parseDorpState(JSON.stringify(old));
  assert.equal(restored.version,3);
  assert.deepEqual(restored.instances.filter(i=>DORP_OBJECT_BY_ID.get(i.objectId)?.kind!=="resident"),old.instances);
  const residents=restored.instances.filter(i=>DORP_OBJECT_BY_ID.get(i.objectId)?.kind==="resident");
  assert.equal(residents.length,5);
  for(const resident of residents){assert.equal(resident.position,null);assert.deepEqual(DORP_OBJECT_BY_ID.get(resident.objectId)?.footprint,[1,1]);}
});


test("dorpsgroei gebruikt exact de canonieke 239 BOM-identiteiten",()=>{
  const keys=new Set(BOFM_CANONICAL_CONTENT_KEYS);
  assert.equal(BOFM_CANONICAL_CONTENT_KEYS.length,239);assert.equal(keys.size,239);
  assert.ok(keys.has("bofm/1-ne#22"));assert.ok(keys.has("bofm/alma#63"));assert.ok(keys.has("bofm/moro#10"));
  for(const invalid of ["bofm/1-ne#0","bofm/1-ne#23","bofm/alma#64","bofm/unknown#1","old-testament/gen#1","study:fsy"]){assert.equal(keys.has(invalid),false);}
});
