import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { cfmReferenceTarget } from "../src/lib/studyContent/cfm2026Adapter";
import { cfmOldTestament2026NlManifest as manifest } from "../src/lib/studyContent/cfm2026Manifest";
import { parseOtbPassage, parseOtbPassageSet } from "../src/lib/references/otb";
import { parseScriptureUrl, verifiedOfficialUrl } from "../src/lib/references/evidence";
import { formatRanges, labelMatchesPassage, parseVerseSpec, standardWorkBookKey } from "../src/lib/references/standardWorks";
import { hymnFromOfficialUrl } from "../src/lib/references/hymns";
import { withHymnLink } from "../src/lib/references/resolver";
import { readManifest } from "../src/lib/hymns/library/server";

// Echte verwijzingen uit de CFM 2026-bronbestanden (data/study-content/cfm-2026-nl/source/*.json), door dezelfde adapterfunctie
// gehaald als bij de import. Geen verzonnen voorbeelden.
const DIR = "data/study-content/cfm-2026-nl/source";
type Link = { lesson: string; href: string; label: string };
const links: Link[] = readdirSync(DIR).flatMap((file) => {
  const html = (JSON.parse(readFileSync(`${DIR}/${file}`, "utf8")) as { body: string }).body;
  // Zoals de adapter: <a href> en de oudere <span data-legacy-href> (de Bijbelverwijzingen staan in die laatste vorm).
  return [...html.matchAll(/<(a|span)\b([^>]*)>([\s\S]*?)<\/\1>/g)].filter((m) => /\b(?:data-legacy-)?href=/.test(m[2])).map((m) => ({
    lesson: file.replace(/\.json$/, ""),
    // Zoals de adapter: href, of data-legacy-href als er geen href is.
    href: (/\bhref="([^"]+)"/.exec(m[2])?.[1] ?? /\bdata-legacy-href="([^"]+)"/.exec(m[2])?.[1] ?? "").replace(/&amp;/g, "&"),
    label: m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
  })).filter((l) => l.href);
});
const lessonUrl = (lesson: string) => manifest.lessons.find((l) => l.sourceKey === lesson)!.sourceUrl;
const targetOf = (l: Link) => cfmReferenceTarget(l.href, l.label, lessonUrl(l.lesson));
const standardWork = links.filter((l) => /\/study\/scriptures\/(bofm|dc-testament|pgp)\//.test(l.href));
const hymns = links.filter((l) => /\/study\/manual\/hymns\/|\/media\/music\/songs\//.test(l.href));

test("de bronbestanden bevatten verwijzingen naar alle soorten", () => {
  assert.ok(links.length > 1000, `aantal verwijzingen: ${links.length}`);
  assert.ok(standardWork.length >= 400, `Boek van Mormon / Leer en Verbonden / Parel van Grote Waarde: ${standardWork.length}`);
  assert.ok(hymns.length >= 60, `lofzangen: ${hymns.length}`);
});

test("Bijbelverwijzingen (Oude Testament) blijven naar de lokale OTB-tekst wijzen", () => {
  const bible = links.filter((l) => /scriptures\/ot\//.test(l.href) && !/\bBJS\b/i.test(l.label));
  assert.ok(bible.length > 200, `bijbelverwijzingen: ${bible.length}`);
  const internal = bible.filter((l) => {
    const key = targetOf(l).sourceKey;
    return Boolean(parseOtbPassage(key) || parseOtbPassageSet(key));
  });
  assert.ok(internal.length / bible.length > 0.85, `${internal.length}/${bible.length}`);
  // Het Nieuwe Testament blijft bewust zonder interne vervanging (geen editiesubstitutie): nooit een otb-doel.
  for (const l of links.filter((x) => /scriptures\/nt\//.test(x.href))) assert.ok(!targetOf(l).sourceKey.startsWith("otb"), l.label);
});

test("elke verwijzing naar een standaardwerk wordt alleen intern als label en bron-URL exact dezelfde passage noemen", () => {
  let internal = 0;
  const external: string[] = [];
  for (const l of standardWork) {
    const url = targetOf(l).sourceKey;
    const passage = parseScriptureUrl(url);
    if (passage && labelMatchesPassage(l.label, passage)) internal++;
    else external.push(`${l.label} | ${l.href}`);
  }
  assert.ok(internal >= 470, `intern: ${internal}`);
  // Wat extern blijft is expliciet en klein: hoofdstukbereiken over meerdere hoofdstukken (de URL noemt er één), een label dat een
  // ander bereik noemt dan de URL, en het titelblad (geen hoofdstuk).
  assert.deepEqual(
    external.map((e) => e.split(" | ")[0]).sort(),
    ["1 Nephi 1–2", "3 Nephi 3–4", "Abraham 1–2", "Abraham 4–5", "Moroni 4–5", "Mozes 2–3", "Mozes 4–5", "titelblad van het Boek van Mormon", "vers 53–65"],
    external.join("\n"),
  );
});

test("samengestelde verwijzingen en versbereiken uit de bron krijgen exact de juiste verzen", () => {
  const find = (label: string) => standardWork.find((l) => l.label === label);
  const cases: Array<[string, string, number, Array<[number, number]>]> = [
    ["1 Nephi 13:21–29, 38–42", "bofm/1-ne", 13, [[21, 29], [38, 42]]],
    ["Mosiah 18:10, 13", "bofm/mosiah", 18, [[10, 10], [13, 13]]],
    ["Mozes 1:4, 6", "pgp/moses", 1, [[4, 4], [6, 6]]],
  ];
  for (const [label, bookKey, chapter, ranges] of cases) {
    const link = find(label);
    assert.ok(link, `ontbreekt in de bron: ${label}`);
    const passage = parseScriptureUrl(targetOf(link).sourceKey)!;
    assert.ok(passage, label);
    assert.deepEqual([passage.bookKey, passage.chapter, passage.ranges], [bookKey, chapter, ranges], label);
    assert.equal(formatRanges(passage.ranges), label.replace(/^.*?:/, "").trim());
  }
});

test("ontbrekende, dubbelzinnige of afwijkende standaardwerkverwijzingen worden niet intern", () => {
  const base = "https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?lang=nld";
  const passage = parseScriptureUrl(`${base}&id=p17-p19%2Cp21`)!;
  assert.ok(passage);
  assert.equal(labelMatchesPassage("Alma 32:17–19, 21", passage), true);
  assert.equal(labelMatchesPassage("Alma 32:17–19", passage), false, "ander bereik");
  assert.equal(labelMatchesPassage("Alma 33:17–19, 21", passage), false, "ander hoofdstuk");
  assert.equal(labelMatchesPassage("Mosiah 32:17–19, 21", passage), false, "ander boek");
  assert.equal(labelMatchesPassage("Alma 32:17–33:2", passage), false, "bereik over hoofdstukken");
  assert.equal(labelMatchesPassage("de profeet", passage), false, "geen passage");
  assert.equal(labelMatchesPassage("vers 17–19, 21", passage), true);
  // Ongeldige bronselecties zijn geen interne doelen.
  for (const bad of ["&id=p21%2Cp17-p19", "&id=p1%2Cp1", "&id=p17-p19%2Cp18", "&id=p17%252Cp19", "&id=p99%2Cp100", "&id=p17%2F", "&id=p17,p%00"])
    assert.equal(parseScriptureUrl(base + bad), null, bad);
  assert.equal(parseScriptureUrl(base.replace("alma/32", "alma/99")), null, "onbekend hoofdstuk");
  assert.equal(parseScriptureUrl(base.replace("alma", "almaa")), null, "onbekend boek");
  assert.equal(parseVerseSpec("5, 3"), null);
  assert.equal(parseVerseSpec("0"), null);
});

test("Nederlandse en Engelse namen en afkortingen van de vier standaardwerken", () => {
  const expect: Array<[string, string]> = [
    ["1 Nephi", "bofm/1-ne"], ["1 Ne.", "bofm/1-ne"], ["Jakob", "bofm/jacob"], ["Jacob", "bofm/jacob"], ["Helaman", "bofm/hel"], ["Moroni", "bofm/moro"],
    ["Leer en Verbonden", "dc-testament/dc"], ["LV", "dc-testament/dc"], ["L&V", "dc-testament/dc"], ["D&C", "dc-testament/dc"], ["Doctrine and Covenants", "dc-testament/dc"],
    ["Mozes", "pgp/moses"], ["Moses", "pgp/moses"], ["Abraham", "pgp/abr"], ["Joseph Smith—Geschiedenis", "pgp/js-h"], ["Geschiedenis van Joseph Smith", "pgp/js-h"], ["Mattheüs naar Joseph Smith", "pgp/js-m"], ["Geloofsartikelen", "pgp/a-of-f"], ["Articles of Faith", "pgp/a-of-f"],
  ];
  for (const [name, key] of expect) assert.equal(standardWorkBookKey(name), key, name);
  assert.equal(standardWorkBookKey("Genesis"), null);
  // Bijbel: Nederlandse én Engelse namen naar dezelfde canonieke sleutels.
  for (const [label, key] of [["Genesis 1:1", "gen"], ["Gen. 1:1", "gen"], ["Psalms 23:1", "psa"], ["Psalmen 23:1", "psa"], ["Ps. 23:1", "psa"], ["Isaiah 53:5", "isa"], ["Jesaja 53:5", "isa"], ["1 Kings 8:10", "1ki"], ["1 Koningen 8:10", "1ki"], ["Song of Solomon 2:1", "sng"], ["Hooglied 2:1", "sng"]] as const)
    assert.equal(parseOtbPassage(label)?.bookKey, key, label);
});

test("lofzangverwijzingen: het officiële lofzang-id (slug) bepaalt het nummer, nooit de titel", () => {
  const manifest = readManifest().hymns;
  const slugs = manifest.map((h) => h.slug).filter(Boolean);
  assert.equal(new Set(slugs).size, slugs.length, "slugs zijn uniek");
  let mapped = 0;
  const unmapped: string[] = [];
  for (const l of hymns) {
    const hymn = hymnFromOfficialUrl(targetOf(l).sourceKey);
    if (hymn) {
      mapped++;
      assert.equal(manifest.find((h) => h.number === hymn.number)?.slug, hymn.slug);
      assert.equal(hymn.href, `/dev/lofzangen?lofzang=${hymn.number}`);
    } else unmapped.push(`${l.label} | ${l.href}`);
  }
  assert.ok(mapped >= 55, `gekoppeld: ${mapped}, niet gekoppeld: ${unmapped.join(" ;; ")}`);
  // Vaste voorbeelden uit de bron.
  assert.equal(hymnFromOfficialUrl("https://www.churchofjesuschrist.org/study/manual/hymns/nearer-my-god-to-thee?lang=nld")?.number, 69);
  assert.equal(hymnFromOfficialUrl("https://www.churchofjesuschrist.org/media/music/songs/all-creatures-of-our-god-and-king")?.number, 38);
  // Onbekend slug, andere taal, extra parameters, andere host of pad: geen koppeling (de externe bron blijft de fallback).
  for (const bad of [
    "https://www.churchofjesuschrist.org/study/manual/hymns/have-i-done-any-good?lang=nld",
    "https://www.churchofjesuschrist.org/study/manual/hymns/nearer-my-god-to-thee?lang=eng",
    "https://www.churchofjesuschrist.org/study/manual/hymns/nearer-my-god-to-thee?lang=nld&x=1",
    "https://www.churchofjesuschrist.org/study/manual/hymns?lang=nld",
    "https://evil.invalid/study/manual/hymns/nearer-my-god-to-thee?lang=nld",
    "http://www.churchofjesuschrist.org/study/manual/hymns/nearer-my-god-to-thee?lang=nld",
    "https://www.churchofjesuschrist.org/study/manual/childrens-songbook/i-am-a-child-of-god?lang=nld",
  ])
    assert.equal(hymnFromOfficialUrl(bad), null, bad);
});

test("een lofzangverwijzing opent alleen in Lofzangen als de gebruiker die mag gebruiken, anders blijft de bewezen externe bron", async () => {
  const url = "https://www.churchofjesuschrist.org/study/manual/hymns/nearer-my-god-to-thee?lang=nld";
  const external = { kind: "external" as const, url, diagnosticKey: "k" };
  const settings = (visible: boolean) => ({ contentSwitcherSettings: { findUnique: async () => ({ hymnsVisibleToUsers: visible }) } }) as never;
  const previous = process.env.HYMNS_POC;
  try {
    delete process.env.HYMNS_POC;
    const admin = await withHymnLink(settings(false), { id: "a", isAdmin: true }, external);
    assert.equal(admin.kind, "hymn");
    assert.equal(admin.kind === "hymn" && admin.number, 69);
    assert.equal((await withHymnLink(settings(false), { id: "u", isAdmin: false }, external)).kind, "external", "verborgen voor gewone gebruikers");
    assert.equal((await withHymnLink(settings(true), { id: "u", isAdmin: false }, external)).kind, "hymn", "zichtbaar na inschakelen");
    process.env.HYMNS_POC = "0";
    assert.equal((await withHymnLink(settings(true), { id: "a", isAdmin: true }, external)).kind, "external", "technische noodstop geldt ook voor beheerders");
    delete process.env.HYMNS_POC;
    const other = { kind: "external" as const, url: "https://www.churchofjesuschrist.org/study/manual/childrens-songbook/i-am-a-child-of-god?lang=nld", diagnosticKey: "k" };
    assert.equal((await withHymnLink(settings(true), { id: "a", isAdmin: true }, other)).kind, "external");
    const unavailable = { kind: "unavailable" as const, reason: "missing" as const, diagnosticKey: "k" };
    assert.equal((await withHymnLink(settings(true), { id: "a", isAdmin: true }, unavailable)).kind, "unavailable");
  } finally {
    if (previous === undefined) delete process.env.HYMNS_POC;
    else process.env.HYMNS_POC = previous;
  }
});

test("de officiële bewezen URL's blijven bewezen (geen verruiming buiten de bekende boeken)", () => {
  const ok = "https://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/13?lang=nld&id=p21-p29%2Cp38-p42#p21";
  assert.equal(verifiedOfficialUrl(ok), ok);
  assert.equal(verifiedOfficialUrl(ok.replace("bofm/1-ne", "bofm/boek")), null);
  assert.equal(verifiedOfficialUrl(ok.replace("%2C", "%2F")), null);
});

test("oude geblokkeerde Bijbeldoelen zijn alleen herbeoordeelbaar bij overeenkomend URL-, label- en editie-bewijs", async () => {
  const { retryableBibleReference } = await import("../src/lib/references/bible");
  const url = "https://www.churchofjesuschrist.org/study/scriptures/ot/jer/1?lang=nld";
  const target = { sourceKey: "otb:jer:1", workKey: "old-testament", editionKey: "otb", language: "nl", externalUrl: url };
  assert.equal(retryableBibleReference(target, "Jeremia 1"), true);
  assert.equal(retryableBibleReference({ sourceKey: url }, "Jeremia 1"), true);
  assert.equal(retryableBibleReference(target, "Johannes 1"), false);
  assert.equal(retryableBibleReference({ ...target, sourceKey: "unverified-numbering:" + url }, "Jeremia 1"), false);
  assert.equal(retryableBibleReference({ ...target, editionKey: "andere-editie" }, "Jeremia 1"), false);
  assert.equal(retryableBibleReference({ sourceKey: "https://www.churchofjesuschrist.org/study/manual/hymns/nearer-my-god-to-thee?lang=nld" }, "Nader, mijn God, tot U"), false);
});

test("ook een bewezen Boek van Mormon-doel kan opnieuw worden beoordeeld; afwijkende passages blijven geblokkeerd", async () => {
 const { retryableScriptureReference } = await import("../src/lib/references/bible");
 const target = { sourceKey: "https://www.churchofjesuschrist.org/study/scriptures/bofm/1-ne/1?lang=nld&id=p1-p3" };
 assert.equal(retryableScriptureReference(target, "1 Nephi 1:1–3"), true);
 assert.equal(retryableScriptureReference(target, "1 Nephi 1:4"), false);
});
