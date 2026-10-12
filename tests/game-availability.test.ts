import test from "node:test";
import assert from "node:assert/strict";
import { GAME_SCOPE_KEYS, supportsGameSource, fixedLiveGameCollectionId } from "../src/lib/gameAvailabilityPolicy";
import { GAME_CATALOG, isGameVisible } from "../src/lib/gameCatalog";
const scripture = { work: "bofm", editionKey: "bofm", language: "nl", kind: "SCRIPTURE" };
test("scopes gebruiken de bestaande catalogus inclusief Woordzoeker", () => {
  assert.deepEqual(new Set(GAME_SCOPE_KEYS), new Set([...GAME_CATALOG.map(g => g.id), "live-exercises"]));
});
test("alle bestaande BOM-spellen; geen adapter ontstaat door scope voor FSY/podcasts/OTB", () => {
  for (const game of GAME_SCOPE_KEYS) {
    assert.equal(supportsGameSource(game, scripture), true);
    for (const kind of ["OTHER", "STUDY_PROGRAM", null]) assert.equal(supportsGameSource(game, { ...scripture, kind }), false);
    for (const work of ["old-testament", "new-testament", "fsy", "podcasts", "unknown", null]) assert.equal(supportsGameSource(game, { ...scripture, work }), false);
    assert.equal(supportsGameSource(game, { ...scripture, editionKey: "unverified" }), false);
    assert.equal(supportsGameSource(game, { ...scripture, language: "xx" }), false);
  }
});
test("bestaande hoofdstukoefeningen zijn ondersteund bij DC/PGP, geen woordpool fallback", () => {
  for (const work of ["dc-testament", "pgp"]) {
    const source = { ...scripture, work, editionKey: work };
    assert.equal(supportsGameSource("live-exercises", source), true);
    assert.equal(supportsGameSource("challenges", source), true);
    assert.equal(supportsGameSource("word-search", source), false);
    assert.equal(supportsGameSource("chapter-guess", source), false);
  }
});
test("normale spelkaart omzeilt uitgeschakelde settings niet voor admins", () => {
  const game = GAME_CATALOG.find(g => g.id === "jigsaw")!;
  const settings = Object.fromEntries(GAME_CATALOG.map(g => [g.enabledKey, false])) as Parameters<typeof isGameVisible>[1];
  for (const admin of [false, true]) {
    assert.equal(isGameVisible(game, settings, ["jigsaw"], admin), false);
    assert.equal(isGameVisible(game, { ...settings, jigsawEnabled: true }, [], admin), false);
    assert.equal(isGameVisible(game, { ...settings, jigsawEnabled: true }, ["jigsaw"], admin), true);
  }
});

test("vaste opgeslagen live-bronnen veranderen niet met beheerinstellingen", () => {
  for (const mode of ["CHAPTER_GUESS", "FAMILY_GAME", "ALLESKENNER", "QUICK_MISSIONARY"]) assert.equal(fixedLiveGameCollectionId(mode), "content_bom");
  for (const mode of ["STUDY", "EXERCISES", "UNKNOWN"]) assert.equal(fixedLiveGameCollectionId(mode), null);
});
