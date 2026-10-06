import test from "node:test";
import assert from "node:assert/strict";
import { pickEditionInFamily, sameEditionFamily } from "../src/lib/contentEdition";

test("verschillende edition identities kunnen naast elkaar bestaan", () => {
  const otbNl = { work: "bible", editionKey: "otb", language: "nl" };
  const hsvNl = { work: "bible", editionKey: "hsv", language: "nl" };
  assert.notEqual(otbNl.editionKey, hsvNl.editionKey);
  assert.equal(sameEditionFamily(otbNl, hsvNl), false);
});

test("audio matching blijft binnen dezelfde edition family", () => {
  const source = { work: "bible", editionKey: "otb", language: "nl" };
  const candidates = [
    { ...source, language: "es", id: "otb-es" },
    { work: "bible", editionKey: "hsv", language: "es", id: "hsv-es" },
  ];
  assert.equal(pickEditionInFamily(candidates, source, "es")?.id, "otb-es");
});
