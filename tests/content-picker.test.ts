import test from "node:test";
import assert from "node:assert/strict";
import { safeContentLocation, pickerGroup, contentSelectionSchema, validPickerEdition, resolvePickerEdition, type PickerEdition, type PickerWork } from "../src/lib/contentPickerContract";
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

const edition = (id: string, family: string, language: string, selectable = true): PickerEdition => ({
  id, slug:id, name:id, icon:"", order:0, work:"work", editionKey:family, language,
  visibleToUsers:selectable, sourceName:null, sourceUrl:null, licenseName:null, licenseUrl:null, selectable, previewHref:null,
});
const work = (editions: PickerEdition[]): PickerWork => ({ key:"work", kind:"SCRIPTURE", editions });

test("compacte bronkaart kiest uitsluitend de globale taal en nooit een verborgen of verkeerde bron", () => {
  const nl = edition("nl","original","nl");
  const hidden = edition("hidden-en","original","en",false);
  const wrongWork = { ...edition("other-en","original","en"), work:"other" };
  assert.deepEqual(resolvePickerEdition(work([nl,hidden,wrongWork]),"en"),{kind:"unavailable"});
  assert.deepEqual(resolvePickerEdition(work([nl]),"nl"),{kind:"available",edition:nl});
  const invalid = { ...edition("invalid","","en") };
  assert.deepEqual(resolvePickerEdition(work([invalid]),"en"),{kind:"unavailable"});
});

test("compacte taalkeuze behoudt de actieve familie, ook wanneer een andere editie eerder staat", () => {
  const active = edition("nl","original","nl");
  const same = edition("en","original","en");
  const alternative = edition("alt","alternative","en");
  assert.deepEqual(resolvePickerEdition(work([alternative,same,active]),"en",active),{kind:"available",edition:same});
  assert.deepEqual(resolvePickerEdition(work([alternative,active]),"en",active),{kind:"choose-edition",editions:[alternative]});
});

test("meerdere publieke families worden bewust gekozen via één globaal editieveld", () => {
  const a = edition("a","first","en"), b = edition("b","second","en");
  const active = { ...edition("elsewhere","family","en"),work:"another-work" };
  assert.deepEqual(resolvePickerEdition(work([a,b]),"en",active),{kind:"choose-edition",editions:[a,b]});
  assert.deepEqual(resolvePickerEdition(work([a]),"en",active),{kind:"available",edition:a});
});
