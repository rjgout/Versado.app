import test from "node:test";
import assert from "node:assert/strict";
import { canAccessCollection, collectionAccessWhere, readingAccessWhere } from "../src/lib/contentAccess";

for (const publicationState of ["LEGACY", "DRAFT", "PUBLISHED"] as const)
for (const isAdmin of [false, true]) for (const enabled of [false, true]) for (const visibleToUsers of [false, true]) {
  test(`toegang ${publicationState}, admin=${isAdmin} enabled=${enabled} visible=${visibleToUsers}`, () => {
    const actor = { isAdmin }, collection = { enabled, visibleToUsers, publicationState, work: "bofm" };
    assert.equal(canAccessCollection(actor, collection), publicationState !== "DRAFT" && enabled && (visibleToUsers || isAdmin));
    assert.equal(canAccessCollection(actor, collection, "catalog"), publicationState !== "DRAFT" && enabled && (visibleToUsers || isAdmin));
    assert.equal(canAccessCollection(actor, collection, "admin-preview"), isAdmin);
  });
}
test("ontbrekende actor, collectie of identiteit krijgt geen toegang, ook geen admin-bypass", () => {
  assert.equal(canAccessCollection(null, { enabled: true, visibleToUsers: true, publicationState: "LEGACY", work: "bofm" }), false);
  assert.equal(canAccessCollection({ isAdmin: true }, null, "admin-preview"), false);
  assert.equal(canAccessCollection({ isAdmin: true }, { enabled: true, visibleToUsers: true, publicationState: "PUBLISHED", work: null }, "admin-preview"), false);
  assert.deepEqual(collectionAccessWhere(null), { id: { in: [] } });
  assert.deepEqual(collectionAccessWhere({ isAdmin: false }, "admin-preview"), { id: { in: [] } });
});
test("leesqueries en catalogus houden beheerpreview expliciet gescheiden", () => {
  const normal = { contentWork: { isNot: null }, publicationState: { in: ["LEGACY", "PUBLISHED"] }, enabled: true, visibleToUsers: true };
  assert.deepEqual(readingAccessWhere({ isAdmin: false }), normal);
  assert.deepEqual(readingAccessWhere({ isAdmin: true }), {contentWork:{isNot:null},publicationState:{in:["LEGACY","PUBLISHED"]},enabled:true});
  assert.deepEqual(readingAccessWhere({ isAdmin: true }, "admin-preview"), { contentWork: { isNot: null } });
  assert.deepEqual(readingAccessWhere({ isAdmin: false }, "admin-preview"), { id: { in: [] } });
  assert.deepEqual(collectionAccessWhere({ isAdmin: true }, "catalog"), { contentWork: { isNot: null }, publicationState: { in: ["LEGACY", "PUBLISHED"] }, enabled: true });
});
