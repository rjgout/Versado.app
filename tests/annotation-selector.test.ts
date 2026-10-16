import assert from "node:assert/strict";
import { test } from "node:test";
import { annotationPutSchema, annotationDeleteSchema, normalizeAnnotationText, passageBlocks, validatePassageSelector, type PassageSelector } from "../src/lib/annotations/contract";
import { parseStudyDocument } from "../src/lib/studyContent/schema";
const document = parseStudyDocument({ schemaVersion: 1, sections: [{ id: "intro", blocks: [
  { id: "p", type: "paragraph", content: [{ type: "text", text: "Je\u0301zus" }, { type: "text", text: " is\tgoed" }] },
  { id: "joined", type: "paragraph", content: [{ type: "text", text: "sa" }, { type: "link", text: "men", href: "https://example.invalid/" }] },
  { id: "emoji", type: "paragraph", content: [{ type: "text", text: "A😀B" }] },
  { id: "quote", type: "quote", content: [{ type: "text", text: "Een citaat" }], attribution: [{ type: "text", text: "Auteur" }] },
  { id: "list", type: "list", ordered: false, items: [{ id: "item", content: [{ type: "text", text: "Eerste" }], children: [{ id: "child", content: [{ type: "text", text: "Kind" }] }], blocks: [{ id: "nested", type: "list", ordered: true, items: [{ id: "nested-item", content: [{ type: "text", text: "Dieper" }] }] }] }] },
] }] });
const selector: PassageSelector = { normalizationVersion: 1, originalRevisionId: "revision", sectionAnchor: "intro", ranges: [{ blockId: "p", start: 0, end: 5 }], exact: "Jézus", prefix: "", suffix: " is goed" };
test("normalisatie v1: NFC, Unicode-witruimte en directe inline-concatenatie", () => {
  assert.equal(normalizeAnnotationText(" \u00a0Je\u0301zus\n\t is goed  "), "Jézus is goed");
  assert.equal(passageBlocks(document, "intro")[1].text, "samen");
  assert.deepEqual(validatePassageSelector(document, selector), selector);
});
test("offsets tellen codepunten; emoji worden niet gehalveerd", () => {
  assert.doesNotThrow(() => validatePassageSelector(document, { ...selector, ranges: [{ blockId: "emoji", start: 1, end: 2 }], exact: "😀", prefix: "A", suffix: "B" }));
  assert.throws(() => validatePassageSelector(document, { ...selector, ranges: [{ blockId: "emoji", start: 1, end: 3 }], exact: "😀", prefix: "A", suffix: "B" }));
});
test("citaten, kinderen en geneste lijsten behouden unieke tekstankers", () => {
  const blocks = passageBlocks(document, "intro");
  assert.deepEqual(blocks.map(b => b.id), ["p", "joined", "emoji", "quote", "item", "nested-item", "child"]);
  assert.equal(blocks[3].text, "Een citaat Auteur");
  assert.doesNotThrow(() => validatePassageSelector(document, { ...selector, ranges: [{ blockId: "nested-item", start: 0, end: 6 }, { blockId: "child", start: 0, end: 4 }], exact: "Dieper\nKind", suffix: "" }));
});
for (const [name, patch] of Object.entries({
  verkeerdeQuote: { exact: "Jezus" }, verkeerdeContext: { prefix: "verzonnen" }, ontbrekendeSectie: { sectionAnchor: "unknown" },
  ontbrekendBlok: { ranges: [{ blockId: "unknown", start: 0, end: 5 }] }, buitenBlok: { ranges: [{ blockId: "p", start: 0, end: 999 }] },
  omgekeerd: { ranges: [{ blockId: "p", start: 5, end: 0 }] },
  overlap: { ranges: [{ blockId: "p", start: 0, end: 5 }, { blockId: "p", start: 3, end: 6 }] },
  aansluitendeDubbeleIdentiteit: { ranges: [{ blockId: "p", start: 0, end: 2 }, { blockId: "p", start: 2, end: 5 }] },
  omgekeerdeBlokken: { ranges: [{ blockId: "emoji", start: 0, end: 1 }, { blockId: "p", start: 0, end: 1 }] },
  onbekendeVersie: { normalizationVersion: 2 },
})) test(`selector weigert ${name}`, () => assert.throws(() => validatePassageSelector(document, { ...selector, ...patch } as PassageSelector)));
test("strikte mutatiecontracten: geen userId, clientversie of onjuiste payload", () => {
  const action = { kind: "note", target: { type: "lesson", lessonEditionId: "edition", revisionId: "revision", selector }, expectedVersion: 0, actionId: "550e8400-e29b-41d4-a716-446655440000", text: "Privé" };
  assert.ok(annotationPutSchema.safeParse(action).success);
  for (const patch of [{ userId: "someone" }, { color: "yellow" }, { text: "" }, { text: "x".repeat(2001) }, { expectedVersion: -1 }]) assert.equal(annotationPutSchema.safeParse({ ...action, ...patch }).success, false);
  assert.equal(annotationPutSchema.safeParse({ ...action, target: { ...action.target, revisionId: "different" } }).success, false);
  assert.equal(annotationDeleteSchema.safeParse(action).success, false);
  assert.ok(annotationDeleteSchema.safeParse({ kind: action.kind, target: action.target, expectedVersion: 0, actionId: action.actionId }).success);
});
