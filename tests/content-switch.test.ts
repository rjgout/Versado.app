import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classifyContentRoute, contentHubHref, pickTargetCollection, remapSearch, workOf, type SwitchCollection } from "../src/lib/contentRouting";
import { LANGUAGES } from "../src/lib/languages";
import { getT } from "../src/lib/i18n";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

const bomNl: SwitchCollection = { id: "bom_nl", work: "bofm", editionKey: "otb", language: "nl" };
const bomEn: SwitchCollection = { id: "bom_en", work: "bofm", editionKey: "otb", language: "en" };
const bomEnOther: SwitchCollection = { id: "bom_en_other", work: "bofm", editionKey: "alt", language: "en" };
const dcNl: SwitchCollection = { id: "dc_nl", work: "dc", editionKey: "otb", language: "nl" };
const dcEn: SwitchCollection = { id: "dc_en", work: "dc", editionKey: "otb", language: "en" };
const noWork: SwitchCollection = { id: "podcasts", work: null, editionKey: "default", language: "nl" };
const all = [bomNl, bomEn, bomEnOther, dcNl, dcEn, noWork];

test("een taalwissel blijft binnen het werk en de uitgavefamilie", () => {
  assert.equal(pickTargetCollection(all, bomNl, { contentLanguage: "en" })?.id, "bom_en");
  assert.equal(pickTargetCollection(all, dcNl, { contentLanguage: "en" })?.id, "dc_en");
  // Met meerdere uitgaven in een taal wint dezelfde familie, anders een andere uitgave van het werk.
  assert.equal(pickTargetCollection([bomNl, bomEnOther, bomEn], { ...bomNl, editionKey: "alt" }, { contentLanguage: "en" })?.id, "bom_en_other");
  assert.equal(pickTargetCollection([bomNl, bomEnOther], bomNl, { contentLanguage: "en" })?.id, "bom_en_other");
});

test("een werk dat niet in de gekozen taal bestaat geeft geen doel", () => {
  assert.equal(pickTargetCollection(all, bomNl, { contentLanguage: "es" }), null);
  assert.equal(pickTargetCollection(all, dcNl, { contentLanguage: "de" }), null);
  assert.equal(pickTargetCollection(all, null, { contentLanguage: "en" }), null);
});

test("een contentwissel kiest precies de gekozen collectie", () => {
  assert.equal(pickTargetCollection(all, bomNl, { contentCollectionId: "dc_nl" })?.id, "dc_nl");
  assert.equal(pickTargetCollection(all, bomNl, { contentCollectionId: "bestaat-niet" }), null);
  assert.equal(workOf(noWork), "podcasts");
});

test("contentgebonden routes worden herkend, de rest is neutraal", () => {
  assert.deepEqual(classifyContentRoute("/courses"), { kind: "courses" });
  assert.deepEqual(classifyContentRoute("/courses/"), { kind: "courses" });
  assert.deepEqual(classifyContentRoute("/courses/c1"), { kind: "course", courseId: "c1" });
  assert.deepEqual(classifyContentRoute("/courses/c1/chapter/h2"), { kind: "courseChapter", courseId: "c1", chapterId: "h2" });
  assert.deepEqual(classifyContentRoute("/lesson/h1"), { kind: "chapter", chapterId: "h1" });
  assert.deepEqual(classifyContentRoute("/reading-lesson/l1"), { kind: "readingLesson", lessonId: "l1" });
  assert.deepEqual(classifyContentRoute("/intro/i1"), { kind: "intro", lessonId: "i1" });
  assert.deepEqual(classifyContentRoute("/kids/k1"), { kind: "kids", storyId: "k1" });
  assert.deepEqual(classifyContentRoute("/fsy/f1"), { kind: "fsy", lessonId: "f1" });
  assert.deepEqual(classifyContentRoute("/podcast/e1/luisteren"), { kind: "podcast", episodeId: "e1" });
  assert.deepEqual(classifyContentRoute("/tools/persons"), { kind: "persons" });
  assert.deepEqual(classifyContentRoute("/tools/dictionary"), { kind: "dictionary", word: null });
  assert.deepEqual(classifyContentRoute("/tools/dictionary/geloof"), { kind: "dictionary", word: "geloof" });
  assert.deepEqual(classifyContentRoute("/tools/dictionary/a%20b"), { kind: "dictionary", word: "a b" });
  assert.equal(contentHubHref(classifyContentRoute("/tools/dictionary/geloof")), "/tools");
  for (const route of ["/dashboard", "/profile", "/friends", "/streak", "/xp", "/tools", "/groups/g1", "/"]) {
    assert.deepEqual(classifyContentRoute(route), { kind: "neutral" }, route);
  }
});

test("spelroutes komen uit de spelcatalogus, ook als er een speltoegang achter staat", () => {
  assert.deepEqual(classifyContentRoute("/word-search"), { kind: "game", gameId: "word-search" });
  assert.deepEqual(classifyContentRoute("/word-search/g1"), { kind: "game", gameId: "word-search" });
  assert.deepEqual(classifyContentRoute("/snelle-zendeling/run/r1"), { kind: "game", gameId: "quick-missionary" });
  assert.deepEqual(classifyContentRoute("/mysteries/003a/play"), { kind: "game", gameId: "mystery" });
  assert.deepEqual(classifyContentRoute("/chapter-guess/solo/s1"), { kind: "game", gameId: "chapter-guess" });
});

test("de uitwijkplek is het onderdeel zelf, nooit een willekeurige pagina", () => {
  assert.equal(contentHubHref(classifyContentRoute("/courses/c1")), "/courses");
  assert.equal(contentHubHref(classifyContentRoute("/lesson/h1")), "/courses");
  assert.equal(contentHubHref(classifyContentRoute("/word-search")), "/live");
  assert.equal(contentHubHref(classifyContentRoute("/tools/persons")), "/tools");
  assert.equal(contentHubHref(classifyContentRoute("/profile")), "/dashboard");
});

test("zoekparameters van de oude content worden vervangen of weggelaten", () => {
  assert.equal(remapSearch("?cursus=a&vers=3", { drop: ["cursus"], set: { cursus: "b" } }), "?vers=3&cursus=b");
  assert.equal(remapSearch("?cursus=a&challengeId=x", { drop: ["cursus", "challengeId"] }), "");
  assert.equal(remapSearch("", {}), "");
});

test("de uitleg 'niet beschikbaar' staat in alle talen en gebruikt de gekozen taal", () => {
  for (const { code } of LANGUAGES) {
    const t = getT(code);
    const vars = { language: "X", content: "Y", current: "Z" };
    for (const key of ["titleLanguage", "bodyLanguage", "titleSection", "bodySection", "stay", "proceed"] as const) {
      const text = t(`contentSwitcher.unavailable.${key}`, vars);
      assert.ok(text.length > 3 && !text.includes("contentSwitcher."), `${code}.${key}`);
    }
  }
  // Spaans blijft Spaans, ook als de app zelf Nederlands is.
  const spanish = getT("es")("contentSwitcher.unavailable.bodyLanguage", { language: "Español", content: "x", current: "Nederlands" });
  assert.match(spanish, /no está disponible en Español/);
  assert.doesNotMatch(spanish, /beschikbaar/);
});

test("de kiezer ververst via de router met de huidige pagina in plaats van een reload", () => {
  const switcher = read("src/components/ContentSwitcher.tsx");
  assert.doesNotMatch(switcher, /location\.reload/);
  assert.match(switcher, /router\.refresh\(\)/);
  assert.match(switcher, /location:\s*\{\s*pathname/);
  const layout = read("src/app/layout.tsx");
  // Content + contenttaal vormen de sleutel van alles onder <main>.
  assert.match(layout, /<Fragment key=\{contentContext \? `\$\{contentContext\.active\.id\}:\$\{contentContext\.contentLanguage\}`/);
});

test("de bestaande profielroute voor taalkeuze blijft een kale wissel zonder pagina-uitleg", () => {
  const route = read("src/app/api/content-context/route.ts");
  assert.match(route, /if \(location\)/);
  assert.match(route, /setContentLanguage\(user\.id, user\.isAdmin, change\.contentLanguage\)/);
});
