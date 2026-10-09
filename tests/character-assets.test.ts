import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { allCharacterAssets, getCharacterAsset, MYSTERY_BODY_ASSETS, normalizeCharacterId } from "../src/lib/characterAssets";
import { allAvatarAccessories } from "../src/lib/avatarAccessories";
import { avatarOptions, canUseAvatarCharacter } from "../src/lib/avatarUnlocks";
import { characterIdForPerson } from "../src/lib/personCharacterMapping";

const BOM_COLLECTION_ID = "content_bom";
const DC_COLLECTION_ID = "content_dc";

test("de runtimecatalogus bevat 73 unieke canonieke personages", () => {
  const characters = allCharacterAssets();
  assert.equal(characters.length, 73);
  assert.equal(new Set(characters.map((character) => character.id)).size, 73);
  assert.equal(normalizeCharacterId("brother-jared"), "brother-of-jared");
  assert.equal(getCharacterAsset("brother-jared")?.id, "brother-of-jared");
  assert.equal(normalizeCharacterId("bestaat-niet"), null);
});

test("alle avatarafbeeldingen gebruiken runtimepaden en uitgesloten rollen zijn niet kiesbaar", () => {
  for (const character of allCharacterAssets()) {
    assert.match(character.avatar, /^\/scripture\//, character.id);
    assert.match(character.bustCompact, /^\/scripture\//, character.id);
    assert.match(character.bustDetail, /^\/scripture\//, character.id);
    for (const assetPath of [character.avatar, character.bustCompact, character.bustDetail, character.fullBody]) {
      assert.ok(existsSync(`${process.cwd()}/public${assetPath.startsWith("/scripture/") ? assetPath : assetPath}`), `${character.id}: ${assetPath}`);
    }
  }
  assert.ok(!getCharacterAsset("jesus-christ")?.avatarAllowed);
  assert.ok(!getCharacterAsset("church-disciple")?.avatarAllowed);
  assert.ok(!getCharacterAsset("heavenly-father")?.avatarAllowed);
});

test("Mysterie behoudt de negen bestaande gekalibreerde full-body-assets", () => {
  assert.deepEqual(MYSTERY_BODY_ASSETS, {
    lehi: "/mysterie-001a-ontdekker/lehi.png",
    sariah: "/mysterie-001a-ontdekker/sariah.png",
    laman: "/mysterie-001a-ontdekker/laman.png",
    lemuel: "/mysterie-001a-ontdekker/lemuel.png",
    sam: "/mysterie-001b-onderzoeker/sam.png",
    nephi: "/mysterie-001c-schriftkenner/nephi.png",
    laban: "/mysterie-002b-onderzoeker/laban.png",
    zoram: "/mysterie-002c-schriftkenner/zoram.png",
    ismael: "/mysterie-003b-onderzoeker/ismael.png",
  });
});

test("de basis- en vroege avatarselectie houdt vrouwen en mannen in evenwicht", () => {
  const options = avatarOptions([]);
  const available = options.filter((option) => option.available);
  assert.deepEqual(available.map((option) => option.id).sort(), [
    "abish", "ammon-missionary", "lamoni-wife", "lehi", "nephi", "nephi-wife", "sam", "sariah",
  ].sort());
  const firstChapter = avatarOptions(["first-chapter"]).filter((option) => option.available);
  assert.ok(firstChapter.some((option) => option.id === "ismael-wife"));
  assert.ok(firstChapter.some((option) => option.id === "lamoni-father-wife"));
  assert.ok(firstChapter.some((option) => option.id === "alma-younger"));
  assert.ok(firstChapter.some((option) => option.id === "king-benjamin"));
  assert.ok(canUseAvatarCharacter("alma-younger", ["first-chapter"]));
  assert.ok(!canUseAvatarCharacter("alma-younger", []));
});

test("accessoires blijven losse vierkante lagen", () => {
  const accessories = allAvatarAccessories();
  assert.equal(accessories.length, 8);
  assert.equal(accessories.filter((item) => item.kind === "frame").length, 3);
  assert.equal(accessories.filter((item) => item.kind === "decoration").length, 3);
  for (const accessory of accessories) {
    assert.match(accessory.compact, /^\/scripture\/accessories\//);
    assert.match(accessory.detail, /^\/scripture\/accessories\//);
  }
});

test("personagemapping is expliciet en laat Alma en andere collecties veilig leeg", () => {
  assert.equal(characterIdForPerson(BOM_COLLECTION_ID, "ammon"), "ammon-missionary");
  assert.equal(characterIdForPerson(BOM_COLLECTION_ID, "ammon-2"), "ammon-expedition");
  assert.equal(characterIdForPerson(BOM_COLLECTION_ID, "moroni-bevelhebber"), "captain-moroni");
  assert.equal(characterIdForPerson(BOM_COLLECTION_ID, "alma"), null);
  assert.equal(characterIdForPerson(DC_COLLECTION_ID, "ammon"), null);
});
