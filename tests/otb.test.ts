import assert from "node:assert/strict";
import test from "node:test";
import { OTB_BOOK_KEY_BY_NUMBER, OTB_BOOKS, OTB_LOCALES, type OtbLocale } from "../scripts/otb/bookMapping";
import { normalizeOtbText } from "../scripts/otb/normalize";
import { OTB_BOOK_NUMBERS, OTB_COLLECTIONS, otbWorkForBookNumber } from "../scripts/otb/trialConfig";
import { otbCollectionName } from "../scripts/otb/collectionNames";
import { sameCanonicalLocation } from "../scripts/otb/canonical";
import { contentAbbreviation } from "../src/lib/contentMetadata";
import { compareSkeletons, scanLocale, assertPinnedSource } from "../scripts/otb/validate";
import { pinnedArchiveUrl } from "../scripts/otb/source";
import { importOtbTrial } from "../scripts/otb/import-core";
import { parseOtbChapter } from "../scripts/otb/chapterParser";
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

test("OTB gebruikt de vijf gevraagde locales en de volledige boekset", () => {
  assert.deepEqual(OTB_LOCALES, ["nl-NL", "en-GB", "es-ES", "fr-FR", "de-DE"]);
  assert.deepEqual(OTB_BOOK_NUMBERS, Array.from({ length: 66 }, (_, index) => index + 1));
  assert.equal(OTB_COLLECTIONS.length, 10);
  assert.ok(OTB_COLLECTIONS.every((collection) => collection.language && collection.editionKey === "otb" && collection.visibleToUsers === false));
  assert.equal(OTB_COLLECTIONS.filter((collection) => collection.work === "old-testament").length, 5);
  assert.equal(OTB_COLLECTIONS.filter((collection) => collection.work === "new-testament").length, 5);
  assert.ok(OTB_COLLECTIONS.every((collection) => String(collection.work) !== "bible"));
  assert.ok(OTB_COLLECTIONS.every((collection) => collection.id.startsWith("content_old_testament_otb_") || collection.id.startsWith("content_new_testament_otb_")));
});

test("OTB gebruikt vertaalde testamentnamen en generieke contentmetadata", () => {
  assert.equal(otbCollectionName("old-testament", "nl"), "Oude Testament");
  assert.equal(otbCollectionName("old-testament", "de"), "Altes Testament");
  assert.equal(otbCollectionName("new-testament", "es"), "Nuevo Testamento");
  assert.equal(contentAbbreviation({ id: "ot", work: "old-testament" }, "nl"), "OT");
  assert.equal(contentAbbreviation({ id: "nt", work: "new-testament" }, "fr"), "NT");
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
  assert.equal(new Set(locations.map((location) => location.language)).size, 5);
  assert.ok(locations.every((location) => sameCanonicalLocation(locations[0], location)));
  assert.equal(sameCanonicalLocation(locations[0], { ...locations[0], editionKey: "hsv" }), false);
  assert.equal(sameCanonicalLocation(locations[0], { ...locations[0], bookKey: "exo" }), false);
  assert.ok(sameCanonicalLocation(
    { work: "new-testament", editionKey: "otb", bookKey: "jhn", chapter: 1, verse: 1 },
    { work: "new-testament", editionKey: "otb", bookKey: "jhn", chapter: 1, verse: 1 },
  ));
});

test("OTB gebruikt alleen de gepinde snapshot-URL en accepteert de downloadmarker", async () => {
  const commit = "31d411ac1c2d277242a3bd85697f354eaa11526b";
  assert.equal(pinnedArchiveUrl({ repository: "OpenTranslationBible/open-bible", upstreamCommit: commit }), `https://github.com/OpenTranslationBible/open-bible/archive/${commit}.tar.gz`);
  const root = await mkdtemp(join(tmpdir(), "otb-lock-test-"));
  try {
    await writeFile(join(root, ".otb-upstream-commit"), `${commit}\n`);
    await assertPinnedSource(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OTB-validatiefout bereikt geen databasewrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "otb-invalid-test-"));
  let writes = 0;
  try {
    await writeFile(join(root, ".otb-upstream-commit"), "31d411ac1c2d277242a3bd85697f354eaa11526b\n");
    const client = {
      $transaction: async () => { writes++; },
    } as never;
    await assert.rejects(() => importOtbTrial(client, root), /OTB-validatie faalt/);
    assert.equal(writes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OTB chapter-parser slaat separators over en bewaart echte multiline verzen", () => {
  const parsed = parseOtbChapter({
    book: "Genesis",
    chapter: 1,
    verses: [
      { verse: 1, text: ["Eerste regel", "Tweede regel"] },
      { text: ["---"] },
      { verse: 2, text: ["Tweede vers"] },
    ],
  }, "nl-NL Genesis 1");
  assert.deepEqual([...parsed.verses.keys()], [1, 2]);
  assert.equal(parsed.verses.get(1), "Eerste regel\nTweede regel");
  assert.deepEqual(parsed.metadata, [{ kind: "separator", text: "---" }]);
  assert.deepEqual(parsed.issues, []);
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
