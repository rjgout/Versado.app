import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseStudyDocument, safeStudyUrlSchema } from "../src/lib/studyContent/schema";
import { studyRevisionHash, validateStudyRevision } from "../src/lib/studyContent/revisions";
import { studyRevisionFixture } from "./fixtures/study-content";
const fixture = () => JSON.parse(JSON.stringify(studyRevisionFixture()));

test("alle negen basistypen, twee lijstniveaus, meertalige tekst en referentiemetadata blijven behouden", () => {
  const value = fixture(); assert.deepEqual(parseStudyDocument(value.body), value.body);
  assert.equal(parseStudyDocument(value.body).sections[0].blocks.length, 9);
});
test("stabiele ankers zijn onafhankelijk van titel, tekst en positie", () => {
  const value = fixture(); value.body.sections[0].blocks.reverse(); value.body.sections[0].blocks[8].content[0].text = "Andere tekst";
  assert.equal(parseStudyDocument(value.body).sections[0].blocks[8].id, "block-heading");
});
for (const change of [
  (v: ReturnType<typeof fixture>) => v.body.sections.push(v.body.sections[0]),
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[1].id = "block-heading",
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[2].items[0].children[0].id = "section-intro",
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[7].id = "item-first",
]) test("dubbele ankers worden documentbreed afgewezen", () => { const v = fixture(); change(v); assert.throws(() => parseStudyDocument(v.body)); });
for (const url of ["javascript:alert(1)", "data:text/html,x", "http://example.invalid", "//example.invalid", "/local", "https://name:secret@example.invalid", "https://example.invalid/\npath", "https:\\example.invalid"]) {
  test(`onveilig URL-protocol/structuur: ${url.replaceAll('\n','newline')}`, () => assert.equal(safeStudyUrlSchema.safeParse(url).success, false));
}
for (const change of [
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[0].html = "<b>text</b>",
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[0].content[0].text = "<script>alert(1)</script>",
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[2].items[0].children[0].children = [],
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[4].type = "unknown-meaningful-block",
  (v: ReturnType<typeof fixture>) => v.body.schemaVersion = 2,
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[0].level = 1,
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[0].id = "",
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[6].mediaKey = "../unsafe",
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[6].height = 0,
  (v: ReturnType<typeof fixture>) => v.body.sections[0].blocks[7].target.sourceKey = "",
]) test("HTML, onbekende betekenisvolle inhoud of ongeldige structuur stopt validatie", () => { const v=fixture();change(v);assert.throws(()=>parseStudyDocument(v.body)); });
test("corrupte, cyclische, te diepe en te lange inhoud geeft een gecontroleerde fout", () => {
  for(const value of [null, 'corrupt-json', {}, {schemaVersion:1,sections:[]}]) assert.throws(()=>parseStudyDocument(value));
  const cycle: Record<string,unknown> = {};cycle.self=cycle;assert.throws(()=>parseStudyDocument(cycle),/CYCLE/);
  let deep: unknown = {};for(let i=0;i<20;i++)deep={child:deep};assert.throws(()=>parseStudyDocument(deep),/LIMIT/);
  const v=fixture();v.body.sections[0].blocks[0].content[0].text="x".repeat(20_001);assert.throws(()=>parseStudyDocument(v.body));
  assert.throws(()=>parseStudyDocument({payload:"x".repeat(2_000_001)}),/LIMIT/);
});
test("SHA-256 is canoniek en omvat titel, body, bron én rechten", () => {
  const v=fixture();const validated=validateStudyRevision(v);
  function independentSort(value: unknown): unknown { return Array.isArray(value)?value.map(independentSort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,independentSort((value as Record<string,unknown>)[k])])):value; }
  const expected=createHash('sha256').update(JSON.stringify(independentSort(validated))).digest('hex');assert.equal(studyRevisionHash(v),expected);
  const shuffled={...v,body:{sections:v.body.sections,schemaVersion:1}};assert.equal(studyRevisionHash(shuffled),expected);
  for(const key of ['title','sourceMetadata','rightsMetadata','body']){const changed=fixture();if(key==='title')changed.title+='!';if(key==='sourceMetadata')changed.sourceMetadata.sourceKey+='!';if(key==='rightsMetadata')changed.rightsMetadata.permission+='!';if(key==='body')changed.body.sections[0].blocks.reverse();assert.notEqual(studyRevisionHash(changed),expected);}
});
test("lege bron/rechten en extra metadata worden niet stilzwijgend verwijderd", () => {
  for(const patch of [{sourceMetadata:{}},{rightsMetadata:{}},{unknown:'discarded'},{schemaVersion:2}])assert.throws(()=>validateStudyRevision({...fixture(),...patch}));
});

test("optionele undefined-velden geven dezelfde hash als de opgeslagen JSON zonder die velden", () => {
  const value=fixture();const expected=studyRevisionHash(value);
  value.sourceMetadata.url=undefined;value.rightsMetadata.licenseUrl=undefined;
  value.body.sections[0].blocks[4].items=undefined;
  assert.equal(studyRevisionHash(value),expected);
});
