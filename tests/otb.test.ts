import assert from "node:assert/strict";
import test from "node:test";
import { OTB_BOOK_KEY_BY_NUMBER, OTB_BOOKS, OTB_LOCALES, type OtbLocale } from "../scripts/otb/bookMapping";
import { normalizeOtbText } from "../scripts/otb/normalize";
import { OTB_TRIAL_BOOK_NUMBERS, OTB_TRIAL_COLLECTIONS, otbWorkForBookNumber } from "../scripts/otb/trialConfig";
import { sameCanonicalLocation } from "../scripts/otb/canonical";
import { compareSkeletons, scanLocale } from "../scripts/otb/validate";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("OTB mapping bevat de volledige upstreamvolgorde", () => {
  assert.equal(OTB_BOOKS.length, 66);
  assert.equal(OTB_BOOK_KEY_BY_NUMBER.get(1), "gen");
  assert.equal(OTB_BOOK_KEY_BY_NUMBER.get(43), "jhn");
  assert.equal(OTB_BOOK_KEY_BY_NUMBER.get(66), "rev");
  assert.equal(OTB_BOOK_KEY_BY_NUMBER.get(39), "mal");
  assert.equal(OTB_BOOK_KEY_BY_NUMBER.get(40), "mat");
  assert.equal(otbWorkForBookNumber(39), "old-testament");
  assert.equal(otbWorkForBookNumber(40), "new-testament");
  assert.equal(new Set(OTB_BOOKS.map(([number]) => number)).size, 66);
  assert.equal(new Set(OTB_BOOKS.map(([, key]) => key)).size, 66);
});

test("OTB text-arraynormalisatie bewaart prose en meerdere regels", () => {
  assert.equal(normalizeOtbText(["Gewone tekst."]), "Gewone tekst.");
  assert.equal(normalizeOtbText(["> Eerste regel", "> Tweede regel"]), "Eerste regel\nTweede regel");
  assert.equal(normalizeOtbText(["Eerste", "Tweede", "Derde"]), "Eerste\nTweede\nDerde");
});

test("OTB gebruikt de vijf gevraagde locales en alleen de drie proefhoofdstukken", () => {
  assert.deepEqual(OTB_LOCALES, ["nl-NL", "en-GB", "es-ES", "fr-FR", "de-DE"]);
  assert.deepEqual(OTB_TRIAL_BOOK_NUMBERS, [1, 19, 43]);
  assert.equal(OTB_TRIAL_COLLECTIONS.length, 10);
  assert.ok(OTB_TRIAL_COLLECTIONS.every((collection) => collection.language && collection.editionKey === "otb" && collection.visibleToUsers === false));
  assert.equal(OTB_TRIAL_COLLECTIONS.filter((collection) => collection.work === "old-testament").length, 5);
  assert.equal(OTB_TRIAL_COLLECTIONS.filter((collection) => collection.work === "new-testament").length, 5);
  assert.ok(OTB_TRIAL_COLLECTIONS.every((collection) => String(collection.work) !== "bible"));
  assert.ok(OTB_TRIAL_COLLECTIONS.every((collection) => collection.id.startsWith("content_old_testament_otb_") || collection.id.startsWith("content_new_testament_otb_")));
});

test("canonical matching gebruikt werk, editionKey, Book.key, hoofdstuk en vers", () => {
  const locations = ["nl", "en", "es", "fr", "de"].map((language) => ({
    language,
    work: "old-testament",
    editionKey: "otb",
    bookKey: "gen",
    chapter: 1,
    verse: 1,
  }));
  assert.ok(locations.every((location) => sameCanonicalLocation(locations[0], location)));
  assert.equal(sameCanonicalLocation(locations[0], { ...locations[0], editionKey: "hsv" }), false);
  assert.equal(sameCanonicalLocation(locations[0], { ...locations[0], bookKey: "exo" }), false);
  assert.ok(["nl", "en", "es", "fr", "de"].every((language) => sameCanonicalLocation(
    { work: "new-testament", editionKey: "otb", bookKey: "jhn", chapter: 1, verse: 1 },
    { work: "new-testament", editionKey: "otb", bookKey: "jhn", chapter: 1, verse: 1 },
  )));
});

test("skeletonvergelijking detecteert ontbrekende en extra locaties", () => {
  const makeScan = (locale: OtbLocale, verseNumbers: number[]) => ({
    locale,
    books: new Map([["gen", { number: 1, name: "Genesis", chapters: new Map([[1, new Map(verseNumbers.map((verse) => [verse, "tekst"]))]]) }]]),
  });
  const issues = compareSkeletons([makeScan("nl-NL", [1, 2]), makeScan("en-GB", [1, 3])]);
  assert.deepEqual(issues.map((item) => [item.locale, item.type, item.verse]), [
    ["en-GB", "missing_verse", 2],
    ["en-GB", "extra_verse", 3],
  ]);
});

test("scanner detecteert dubbele verzen en gaten", async () => {
  const root = await mkdtemp(join(tmpdir(), "otb-test-"));
  try {
    const jsonRoot = join(root, "lang", "nl-NL", "01.Genesis", "json");
    await mkdir(jsonRoot, { recursive: true });
    await writeFile(join(jsonRoot, "genesis-01.json"), JSON.stringify({
      book: "Genesis",
      chapter: 1,
      verses: [
        { verse: 1, text: ["één"] },
        { verse: 1, text: ["dubbel"] },
        { verse: 3, text: ["drie"] },
      ],
    }));
    const scan = await scanLocale(root, "nl-NL");
    assert.ok(scan.issues.some((item) => item.type === "duplicate_verse" && item.verse === 1));
    assert.ok(scan.issues.some((item) => item.type === "missing_verse" && item.verse === 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
