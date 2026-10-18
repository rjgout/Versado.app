import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { DORP_ASSETS, DORP_OBJECT_BY_ID, DORP_OBJECTS, DORP_RESIDENTS, assetForObject } from "../src/lib/dorp/catalog";
import { canAccessDorpPrototype, dorpPrototypeEnabled } from "../src/lib/dorp/access";
import {
  PROTOTYPE_PHASES,
  buildableTileCount,
  footprintTiles,
  isTileBuildable,
  placementIsValid,
  radiusForPhase,
  suggestPlacement,
} from "../src/lib/dorp/geometry";
import { DEFAULT_DORP_STATE, DORP_STORAGE_KEY, parseDorpState, serializeDorpState } from "../src/lib/dorp/storage";
import type { PlacedDorpObject } from "../src/lib/dorp/types";
import { shellModeForRoute } from "../src/lib/focusMode";

test("kaartgeometrie volgt exact het cirkelmasker en de zestien uitbreidingen", () => {
  assert.equal(buildableTileCount(14), 613);
  assert.equal(buildableTileCount(62), 12_061);
  assert.equal(radiusForPhase(0), 14);
  assert.equal(radiusForPhase(16), 62);
  assert.equal(radiusForPhase(999), 62);
  assert.equal(isTileBuildable(14, 0, 14), true);
  assert.equal(isTileBuildable(14, 1, 14), false);
  assert.deepEqual(PROTOTYPE_PHASES.map((phase) => phase.radius), [14, 17, 38, 62]);
});

test("footprints bepalen plaatsing, overlap en kaartgrens", () => {
  const family: PlacedDorpObject = { instanceId: "a", objectId: "vd-b001", level: 1, u: -1, v: -1 };
  assert.equal(placementIsValid(family, [], 14), true);
  assert.equal(placementIsValid({ instanceId: "b", objectId: "vd-b002", u: 0, v: 0 }, [family], 14), false);
  assert.equal(placementIsValid({ instanceId: "b", objectId: "vd-l001", u: 8, v: 8 }, [], 14), false);
  assert.equal(placementIsValid({ ...family, u: 2, v: 2 }, [family], 14), true, "verplaatsen negeert de eigen oude footprint");
  assert.equal(footprintTiles(0, 0, [12, 12]).length, 144);
  assert.ok(suggestPlacement("vd-l001", [], 14), "de tempel past fysiek op R14");
  assert.equal(suggestPlacement("vd-l001", [], 7), null, "de tempel past fysiek niet op R7");
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

test("lokale opslag herlaadt geldige data en verwerpt versies, overlap en ongeldige niveaus", () => {
  assert.match(DORP_STORAGE_KEY, /v1$/);
  assert.deepEqual(parseDorpState(serializeDorpState(DEFAULT_DORP_STATE)), DEFAULT_DORP_STATE);
  assert.deepEqual(parseDorpState(JSON.stringify({ ...DEFAULT_DORP_STATE, version: 2 })), DEFAULT_DORP_STATE);
  const parsed = parseDorpState(JSON.stringify({
    version: 1,
    phase: 0,
    objects: [
      { instanceId: "goed", objectId: "vd-b001", level: 3, u: 0, v: 0 },
      { instanceId: "overlap", objectId: "vd-b002", level: 1, u: 1, v: 1 },
      { instanceId: "niveau", objectId: "vd-b003", level: 8, u: 7, v: 7 },
      { instanceId: "onbekend", objectId: "privé-object", level: 1, u: 7, v: 7 },
    ],
  }));
  assert.deepEqual(parsed.objects.map((object) => object.instanceId), ["goed"]);
});

test("pilotcatalogus gebruikt bestaande Work-assets, footprints en canonieke bewoners", () => {
  assert.ok(DORP_OBJECTS.length >= 10);
  assert.deepEqual(DORP_OBJECT_BY_ID.get("vd-b001")?.footprint, [3, 3]);
  assert.deepEqual(DORP_OBJECT_BY_ID.get("vd-b002")?.footprint, [3, 3]);
  assert.deepEqual(DORP_OBJECT_BY_ID.get("vd-b003")?.footprint, [4, 4]);
  assert.deepEqual(DORP_OBJECT_BY_ID.get("vd-l001")?.footprint, [12, 12]);
  for (const asset of DORP_ASSETS) {
    assert.match(asset.path, /^\/versado-dorp-bom-v1\/assets\//);
    assert.ok(existsSync(`${process.cwd()}/public${asset.path}`), asset.path);
    assert.ok(asset.anchor[0] >= 0 && asset.anchor[0] <= 1);
    assert.ok(asset.anchor[1] >= 0 && asset.anchor[1] <= 1);
  }
  assert.deepEqual(DORP_RESIDENTS.map((resident) => resident.characterId), ["nephi", "sariah", "ammon-missionary", "lehi"]);
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
