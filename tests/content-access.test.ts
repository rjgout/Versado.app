import test from "node:test";
import assert from "node:assert/strict";
import { canAccessLegacyCollection, collectionAccessWhere, readingAccessWhere } from "../src/lib/contentAccess";

for (const isAdmin of [false, true]) for (const enabled of [false, true]) for (const visibleToUsers of [false, true]) {
  test(`legacytoegang admin=${isAdmin} enabled=${enabled} visible=${visibleToUsers}`, () => {
    const actor = { isAdmin }, collection = { enabled, visibleToUsers };
    assert.equal(canAccessLegacyCollection(actor, collection), enabled && visibleToUsers);
    assert.equal(canAccessLegacyCollection(actor, collection, "catalog"), enabled && (visibleToUsers || isAdmin));
    assert.equal(canAccessLegacyCollection(actor, collection, "admin-preview"), isAdmin);
  });
}
test("ontbrekende actor of collectie krijgt geen toegang, ook geen admin-bypass", () => {
  assert.equal(canAccessLegacyCollection(null, { enabled: true, visibleToUsers: true }), false);
  assert.equal(canAccessLegacyCollection({ isAdmin: true }, null, "admin-preview"), false);
  assert.deepEqual(collectionAccessWhere(null), { id: { in: [] } });
  assert.deepEqual(collectionAccessWhere({ isAdmin: false }, "admin-preview"), { id: { in: [] } });
});
test("leesqueries en catalogus houden beheerpreview expliciet gescheiden", () => {
  assert.deepEqual(readingAccessWhere({ isAdmin: false }), { enabled: true, visibleToUsers: true });
  assert.deepEqual(readingAccessWhere({ isAdmin: true }), { enabled: true, visibleToUsers: true });
  assert.deepEqual(readingAccessWhere({ isAdmin: true }, "admin-preview"), {});
  assert.deepEqual(readingAccessWhere({ isAdmin: false }, "admin-preview"), { id: { in: [] } });
  assert.deepEqual(collectionAccessWhere({ isAdmin: true }, "catalog"), { enabled: true });
});
