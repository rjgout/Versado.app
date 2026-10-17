// Fase 4D: pure resolvertests. Geen database; de resolver beslist uitsluitend op stabiele anker-ID's en exacte tekst.
import assert from "node:assert/strict";
import { test } from "node:test";
import { passageBlocks, validatePassageSelector, type PassageSelector } from "../src/lib/annotations/contract";
import { placeAnnotation, type PlacementLesson, type PlacementRow } from "../src/lib/annotations/revisionResolution";

type Block = { id: string; text: string; type?: string; children?: Block[] };
const inline = (text: string) => [{ type: "text", text }];
const paragraph = (b: Block): Record<string, unknown> => b.type === "list"
  ? { id: b.id, type: "list", ordered: false, items: (b.children ?? []).map((c) => ({ id: c.id, content: inline(c.text) })) }
  : b.type === "table"
    ? { id: b.id, type: "table", rows: [{ id: `${b.id}-r`, cells: (b.children ?? []).map((c) => ({ id: c.id, header: false, colSpan: 1, rowSpan: 1, content: inline(c.text) })) }] }
    : { id: b.id, type: "paragraph", content: inline(b.text) };
const body = (sections: Array<{ id: string; blocks: Block[] }>) => ({ sections: sections.map((s) => ({ id: s.id, blocks: s.blocks.map(paragraph) })) });
const lesson = (revisionId: string, sections: Array<{ id: string; blocks: Block[] }>, editionId = "ed1"): PlacementLesson => ({ editionId, revisionId, body: body(sections) });

/** Bouwt een door de bestaande validator geldige selector voor revisie `revisionId`. */
function select(l: PlacementLesson, sectionAnchor: string, ranges: Array<[string, number, number]>): PassageSelector {
  const blocks = passageBlocks(l.body, sectionAnchor);
  const chars = (id: string) => [...blocks.find((b) => b.id === id)!.text];
  const exact = ranges.map(([id, a, b]) => chars(id).slice(a, b).join("")).join("\n");
  const [firstId, firstStart] = ranges[0], last = ranges.at(-1)!;
  return validatePassageSelector(l.body, {
    normalizationVersion: 1, originalRevisionId: l.revisionId, sectionAnchor,
    ranges: ranges.map(([blockId, start, end]) => ({ blockId, start, end })), exact,
    prefix: chars(firstId).slice(Math.max(0, firstStart - 32), firstStart).join(""),
    suffix: chars(last[0]).slice(last[2], last[2] + 32).join(""),
  });
}
const row = (l: PlacementLesson, selector: PassageSelector, extra: Partial<PlacementRow> = {}): PlacementRow => ({ lessonEditionId: l.editionId, revisionId: l.revisionId, selector, ...extra });

const r1 = lesson("r1", [{ id: "intro", blocks: [{ id: "a", text: "De Heer is mijn herder en ik zal niets tekortkomen." }, { id: "b", text: "Hij laat mij rusten in groene weiden." }] }, { id: "end", blocks: [{ id: "c", text: "Besluit van de les." }] }]);

test("1. ongewijzigde revisie: de oorspronkelijke selector geldt", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const result = placeAnnotation(r1, row(r1, sel));
  assert.equal(result.status, "EXACT");
  assert.equal(result.status === "EXACT" && result.via, "original");
});

test("2. nieuwe revisie met identiek blok en identieke tekst: automatisch exact, oorspronkelijke velden ongemoeid", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a", text: "De Heer is mijn herder en ik zal niets tekortkomen." }, { id: "b", text: "Hij laat mij rusten in groene weiden." }] }, { id: "end", blocks: [{ id: "c", text: "Besluit van de les." }] }]);
  const result = placeAnnotation(r2, row(r1, sel));
  assert.equal(result.status, "EXACT");
  assert.equal(result.status === "EXACT" && result.selector.originalRevisionId, "r2", "effectieve selector hoort bij de actuele revisie");
  assert.equal(sel.originalRevisionId, "r1", "de oorspronkelijke selector is niet gemuteerd");
});

test("3. dezelfde quote op een verschoven offset binnen hetzelfde bewezen anker (uniek in het blok)", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]); // "Heer is mijn h"
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a", text: "Voorwoord: De Heer is mijn herder en ik zal niets tekortkomen." }, { id: "b", text: "x" }] }]);
  const result = placeAnnotation(r2, row(r1, sel));
  assert.equal(result.status, "EXACT");
  assert.deepEqual(result.status === "EXACT" && result.selector.ranges, [{ blockId: "a", start: 3 + 11, end: 17 + 11 }]);
});

test("4. dezelfde quote tweemaal in hetzelfde blok na verschuiving: nooit gokken", () => {
  const sel = select(r1, "intro", [["b", 0, 4]]); // "Hij "
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a", text: "x" }, { id: "b", text: "Eerst. Hij laat. Hij blijft." }] }]);
  assert.deepEqual(placeAnnotation(r2, row(r1, sel)), { status: "ORPHANED", reason: "ambiguous" });
});

test("5. blok vervangen; dezelfde quote één keer in een ander blok van dezelfde sectie: alleen een voorstel", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a2", text: "Nieuw blok: De Heer is mijn herder en meer." }, { id: "b", text: "Hij laat mij rusten in groene weiden." }] }]);
  const result = placeAnnotation(r2, row(r1, sel));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.status === "NEEDS_REVIEW" && result.proposal.ranges[0].blockId, "a2");
});

test("5b. dezelfde quote in twee verschillende blokken (oorspronkelijk blok weg): ambigu, geen voorstel", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "x", text: "De Heer is mijn herder." }, { id: "y", text: "De Heer is mijn herder ook hier." }] }]);
  assert.deepEqual(placeAnnotation(r2, row(r1, sel)), { status: "ORPHANED", reason: "ambiguous" });
});

test("6. volledig verplaatst blok binnen dezelfde sectie met hetzelfde ID blijft exact", () => {
  const sel = select(r1, "intro", [["b", 0, 10]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "b", text: "Hij laat mij rusten in groene weiden." }, { id: "a", text: "De Heer is mijn herder en ik zal niets tekortkomen." }] }]);
  assert.equal(placeAnnotation(r2, row(r1, sel)).status, "EXACT");
});

test("6b. blok naar een andere sectie verplaatst: geen automatische koppeling over secties heen", () => {
  const sel = select(r1, "intro", [["b", 0, 10]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a", text: "alleen dit" }] }, { id: "end", blocks: [{ id: "b", text: "Hij laat mij rusten in groene weiden." }] }]);
  assert.deepEqual(placeAnnotation(r2, row(r1, sel)), { status: "ORPHANED", reason: "text" });
});

test("7. verwijderd blok: ORPHANED, geen andere passage", () => {
  const sel = select(r1, "intro", [["b", 0, 10]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a", text: "De Heer is mijn herder en ik zal niets tekortkomen." }] }]);
  assert.deepEqual(placeAnnotation(r2, row(r1, sel)), { status: "ORPHANED", reason: "text" });
});

test("8. gewijzigde quote: ORPHANED", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a", text: "De Heer is mijn leider en ik zal niets tekortkomen." }] }]);
  assert.equal(placeAnnotation(r2, row(r1, sel)).status, "ORPHANED");
});

test("9. meerdere ranges in één sectie, volgorde behouden: exact", () => {
  const sel = select(r1, "intro", [["a", 0, 10], ["b", 0, 8]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "n", text: "Nieuw." }, { id: "a", text: "Eerst. De Heer is mijn herder en ik zal niets tekortkomen." }, { id: "b", text: "Hij laat mij rusten in groene weiden." }] }]);
  const result = placeAnnotation(r2, row(r1, sel));
  assert.equal(result.status, "EXACT");
  assert.equal(result.status === "EXACT" && result.selector.ranges.length, 2);
});

test("10. meerdere ranges waarvan één ontbreekt: nooit een gedeeltelijke match", () => {
  const sel = select(r1, "intro", [["a", 0, 10], ["b", 0, 8]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a", text: "De Heer is mijn herder en ik zal niets tekortkomen." }, { id: "b", text: "Totaal andere zin." }] }]);
  assert.deepEqual(placeAnnotation(r2, row(r1, sel)), { status: "ORPHANED", reason: "text" });
});

test("10b. meerdere ranges in omgekeerde volgorde: geen geldige selector, dus geen koppeling", () => {
  const sel = select(r1, "intro", [["a", 0, 10], ["b", 0, 8]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "b", text: "Hij laat mij rusten in groene weiden." }, { id: "a", text: "De Heer is mijn herder en ik zal niets tekortkomen." }] }]);
  assert.notEqual(placeAnnotation(r2, row(r1, sel)).status, "EXACT");
});

test("11. Unicode NFC: gedecomposeerde tekst in de nieuwe revisie vindt dezelfde passage", () => {
  const l1 = lesson("r1", [{ id: "s", blocks: [{ id: "a", text: "Café-gesprek over vergeving." }] }]);
  const sel = select(l1, "s", [["a", 0, 4]]);
  const l2 = lesson("r2", [{ id: "s", blocks: [{ id: "a", text: "Voor: Café-gesprek over vergeving." }] }]);
  const result = placeAnnotation(l2, row(l1, sel));
  assert.equal(result.status, "EXACT");
  assert.equal(result.status === "EXACT" && result.selector.exact, "Café");
});

test("12. samengestelde emoji en surrogaten tellen als codepunten, nooit als losse code-units", () => {
  const l1 = lesson("r1", [{ id: "s", blocks: [{ id: "a", text: "Hallo 😀 wereld 👨‍👩‍👧 einde." }] }]);
  const sel = select(l1, "s", [["a", 6, 14]]);
  const l2 = lesson("r2", [{ id: "s", blocks: [{ id: "a", text: "Nu: Hallo 😀 wereld 👨‍👩‍👧 einde." }] }]);
  const result = placeAnnotation(l2, row(l1, sel));
  assert.equal(result.status, "EXACT");
  assert.equal(result.status === "EXACT" && result.selector.exact, sel.exact);
});

test("13. geneste lijstitems en tabelcellen hebben eigen stabiele ankers", () => {
  const list = { id: "l", type: "list", text: "", children: [{ id: "i1", text: "Eerste punt" }, { id: "i2", text: "Tweede punt over liefde" }] };
  const table = { id: "t", type: "table", text: "", children: [{ id: "c1", text: "Cel een" }, { id: "c2", text: "Cel twee met inhoud" }] };
  const l1 = lesson("r1", [{ id: "s", blocks: [list, table] }]);
  const sel = select(l1, "s", [["i2", 0, 6], ["c2", 0, 3]]);
  const l2 = lesson("r2", [{ id: "s", blocks: [list, table] }]);
  assert.equal(placeAnnotation(l2, row(l1, sel)).status, "EXACT");
  const l3 = lesson("r3", [{ id: "s", blocks: [{ ...list, children: [{ id: "i1", text: "Eerste punt" }] }, table] }]);
  assert.notEqual(placeAnnotation(l3, row(l1, sel)).status, "EXACT");
});

test("14. gelijknamige secties zonder bewezen identiteit (ander ID) geven geen koppeling", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const r2 = lesson("r2", [{ id: "inleiding", blocks: [{ id: "a", text: "De Heer is mijn herder en ik zal niets tekortkomen." }] }]);
  assert.deepEqual(placeAnnotation(r2, row(r1, sel)), { status: "ORPHANED", reason: "section" });
});

test("15/16/17. andere taal, andere collectie of andere leseditie: nooit automatisch", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const english = lesson("r9", [{ id: "intro", blocks: [{ id: "a", text: "The Lord is my shepherd; I shall not want." }] }], "ed-en");
  assert.deepEqual(placeAnnotation(english, row(r1, sel)), { status: "ORPHANED", reason: "edition" });
  const sameTextOtherEdition = lesson("r9", [{ id: "intro", blocks: [{ id: "a", text: "De Heer is mijn herder en ik zal niets tekortkomen." }] }], "ed-other");
  assert.deepEqual(placeAnnotation(sameTextOtherEdition, row(r1, sel)), { status: "ORPHANED", reason: "edition" });
  assert.deepEqual(placeAnnotation(r1, { lessonEditionId: null, revisionId: null, selector: null }), { status: "ORPHANED", reason: "edition" });
});

test("18. historische revisie opnieuw gepubliceerd (rollback): de oorspronkelijke selector geldt weer", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "z", text: "heel anders" }] }]);
  assert.equal(placeAnnotation(r2, row(r1, sel)).status, "ORPHANED");
  const result = placeAnnotation(r1, row(r1, sel));
  assert.equal(result.status === "EXACT" && result.via, "original");
});

test("bevestigde koppeling: geldt alleen voor haar eigen revisie en wordt nooit blind op een andere toegepast", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "a2", text: "Nieuw blok: De Heer is mijn herder en meer." }] }]);
  const proposal = placeAnnotation(r2, row(r1, sel));
  assert.equal(proposal.status, "NEEDS_REVIEW");
  const resolved = proposal.status === "NEEDS_REVIEW" ? proposal.proposal : null;
  assert.ok(resolved);
  const confirmed = row(r1, sel, { resolvedRevisionId: "r2", resolvedSelector: resolved });
  const same = placeAnnotation(r2, confirmed);
  assert.equal(same.status === "EXACT" && same.via, "resolved");
  // Derde revisie waarin dezelfde tekst in a2 blijft: de bevestigde locatie is het vertrekpunt en blijft veilig herkenbaar.
  const r3 = lesson("r3", [{ id: "intro", blocks: [{ id: "a2", text: "Nieuw blok: De Heer is mijn herder en meer." }] }]);
  assert.equal(placeAnnotation(r3, confirmed).status, "EXACT");
  // Derde revisie waarin die tekst verdwijnt: de oude bevestigde selector geeft géén koppeling.
  const r4 = lesson("r4", [{ id: "intro", blocks: [{ id: "q", text: "niets herkenbaars" }] }]);
  assert.equal(placeAnnotation(r4, confirmed).status, "ORPHANED");
  // Rollback naar de oorspronkelijke revisie: de oorspronkelijke selector geldt weer.
  const back = placeAnnotation(r1, confirmed);
  assert.equal(back.status === "EXACT" && back.via, "original");
});

test("ambigue overeenkomst wordt nooit automatisch EXACT, ook niet met een ongeldige bevestigde selector", () => {
  const sel = select(r1, "intro", [["a", 3, 17]]);
  const r2 = lesson("r2", [{ id: "intro", blocks: [{ id: "x", text: "De Heer is mijn herder." }, { id: "y", text: "De Heer is mijn herder ook hier." }] }]);
  const result = placeAnnotation(r2, row(r1, sel, { resolvedRevisionId: "r2", resolvedSelector: { not: "valid" } }));
  assert.equal(result.status, "ORPHANED");
});
