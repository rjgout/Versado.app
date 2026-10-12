import test from "node:test";
import assert from "node:assert/strict";
import { safeContentLocation, pickerGroup, contentSelectionSchema, validPickerEdition } from "../src/lib/contentPickerContract";
import { pickTargetCollection } from "../src/lib/contentRouting";
import { isActivityRoute, shellModeForRoute } from "../src/lib/focusMode";
import { getT } from "../src/lib/i18n";
import { LANGUAGES } from "../src/lib/languages";

test("vertrekcontext weigert externe, protocol-relative, backslash-, dot- en gevoelige routes", () => {
  for (const pathname of ["https://evil.test", "//evil.test", "/\\evil", "/x/../profile", "/x?next=evil", "/login", "/api/users", "/uitschrijven/token", "/content", "/x%00"]) {
    assert.equal(safeContentLocation({ pathname, search: "" }), null, pathname);
  }
  assert.deepEqual(safeContentLocation({ pathname: "/lesson/real", search: "?cursus=abc&vers=3&token=secret&email=private&returnTo=https://evil.test&challengeId=private" }), { pathname: "/lesson/real", search: "?cursus=abc&vers=3" });
});

test("groepering gebruikt technische soort; OTHER wordt geen studieprogramma", () => {
  assert.equal(pickerGroup("SCRIPTURE"), "scriptures");
  assert.equal(pickerGroup("STUDY_PROGRAM"), "studyPrograms");
  assert.equal(pickerGroup("OTHER"), "studyPrograms");
  assert.ok(!contentSelectionSchema.safeParse({ activeContentCollectionId: null, contentLanguage: "nl", userId: "other" }).success);
});

test("alleen geregistreerde talen en niet-lege werk-/editie-identiteiten zijn selecteerbaar", () => {
  assert.ok(validPickerEdition({ work: "work", editionKey: "edition", language: "nl" }));
  for (const change of [{ work: null }, { work: " " }, { editionKey: "" }, { editionKey: " " }, { language: "invented" }]) {
    assert.ok(!validPickerEdition({ work: "work", editionKey: "edition", language: "nl", ...change }));
  }
});

test("nieuwe taalkeuze blijft strikt in de familie, oude resolvercompatibiliteit blijft expliciet", () => {
  const a = { id: "a", work: "work", editionKey: "original", language: "nl" };
  const b = { id: "b", work: "work", editionKey: "other", language: "en" };
  assert.equal(pickTargetCollection([a,b], a, { contentLanguage: "en" }, "exact"), null);
  assert.equal(pickTargetCollection([a,b], a, { contentCollectionId: "b" }, "exact"), b);
  assert.equal(pickTargetCollection([a,b], a, { contentLanguage: "en" }), b);
});

test("contentkiezer is Focus maar geen leeractiviteit; vijf echte vertalingen", () => {
  assert.equal(shellModeForRoute("/content"), "focus");
  assert.equal(isActivityRoute("/content"), false);
  const titles = new Set<string>();
  for (const language of LANGUAGES) {
    const t = getT(language.code);
    titles.add(t("contentSwitcher.picker.title"));
    for (const key of ["scriptures", "studyPrograms", "noDestination", "conflict", "languageHelp"] as const) assert.ok(!t(`contentSwitcher.picker.${key}`).includes("contentSwitcher."));
  }
  assert.equal(titles.size, 5);
});
