import { test } from "node:test";
import assert from "node:assert/strict";
import { bibleUrlTarget } from "../src/lib/references/bible";
import { parseOtbPassageSet } from "../src/lib/references/otb";
import { formatWeekPeriod } from "../src/components/study/PersonalStudyParts";
import { resolveReferenceTarget } from "../src/lib/references/resolver";
import type { Prisma } from "../src/generated/prisma/client";
const url = (book: string, chapter: number, lang = "nld") => `https://www.churchofjesuschrist.org/study/scriptures/nt/${book}/${chapter}?lang=${lang}`;
test("Nieuwe Testament: hoofdstukken, verzen en meerdere passages", () => {
  for (const [book, label, key] of [["matt", "Mattheüs 2", "mat"], ["luke", "Lukas 2", "luk"], ["john", "Johannes 1", "jhn"]]) {
    assert.equal(bibleUrlTarget(url(book, book === "john" ? 1 : 2), label)?.sourceKey, `otb:${key}:${book === "john" ? 1 : 2}`);
  }
  assert.equal(bibleUrlTarget(url("john", 1) + "&id=p3-p5", "Johannes 1:3–5")?.sourceKey, "otb:jhn:1:3,4,5");
  assert.equal(bibleUrlTarget(url("john", 1) + "&id=p3", "Johannes 1:3")?.sourceKey, "otb:jhn:1:3");
  assert.equal(parseOtbPassageSet(bibleUrlTarget(url("john", 1), "Johannes 1–3; 7")!.sourceKey)?.length, 4);
  assert.equal(bibleUrlTarget(url("john", 1), "Lukas 1"), null);
  assert.equal(bibleUrlTarget(url("john", 1) + "&id=p4", "Johannes 1:3"), null);
});
test("datumregel toont één jaartal, en beide jaren bij de jaargrens", () => {
  for (const [a,b,year] of [["2026-10-19","2026-10-26","2026"], ["2027-01-04","2027-01-11","2027"]]) {
    const label = formatWeekPeriod(a,b,"nl")!;
    assert.equal(label.match(new RegExp(year,"g"))?.length, 1);
  }
  const boundary = formatWeekPeriod("2026-12-28","2027-01-04","nl")!;
  assert.match(boundary,/2026/); assert.match(boundary,/2027/);
});
test("datumregel is stabiel tussen Node- en browser-ICU, ook over maand en jaar", () => {
  assert.equal(formatWeekPeriod("2026-10-19","2026-10-26","nl"),"19–25 oktober 2026");
  assert.equal(formatWeekPeriod("2026-10-26","2026-11-02","nl"),"26 oktober – 1 november 2026");
  assert.equal(formatWeekPeriod("2026-12-28","2027-01-04","nl"),"28 december 2026 – 3 januari 2027");
  for(const locale of ["nl","en","de","fr","es"]) {
    const label=formatWeekPeriod("2026-12-28","2027-01-04",locale)!;
    assert.doesNotMatch(label,/[\u00a0\u2009\u202f]/);
    assert.equal(label.match(/2026/g)?.length,1);assert.equal(label.match(/2027/g)?.length,1);
  }
});
test("resolver gebruikt toegankelijke OTB-editie en bestaande reader; ontbrekende vertaling valt extern terug", async () => {
  for (const [code, language] of [["nld","nl"],["eng","en"],["deu","de"],["fra","fr"],["spa","es"]]) {
    for (const available of [true,false]) {
      const collection = { id: "nt", work: "new-testament", editionKey: "otb", language, name: "NT" };
      const db = {
        contentCollection: { findFirst: async ({where}: {where: Record<string,unknown>}) => { assert.equal(where.language,language); return available ? collection : null; } },
        chapter: { findFirst: async () => ({ id: "john-1", number: 1, book: { name: "Johannes", contentCollection: collection }, verses: [{id:"v",number:3,text:"tekst"}] }) },
      } as unknown as Prisma.TransactionClient;
      const result = await resolveReferenceTarget(db,{id:"user",isAdmin:false},{workKey:"cfm-new-testament-2027",editionKey:"cfm",language,collectionId:"cfm"},{sourceKey:url("john",1,code)+"&id=p3"},"test",undefined,undefined,0,"Johannes 1:3");
      assert.equal(result.kind, available ? "internal" : "external");
      if (result.kind === "internal") assert.equal(result.href,"/scripture/john-1#vers-3");
    }
  }
});

test("Jeremia: alle gevraagde hoofdstukreeksen blijven afzonderlijke passages", () => {
 const target = bibleUrlTarget("https://www.churchofjesuschrist.org/study/scriptures/ot/jer/1?lang=nld", "Jeremia 1–3; 7; 16–18; 20");
 assert.deepEqual(parseOtbPassageSet(target!.sourceKey)?.map(p=>p.chapter),[1,2,3,7,16,17,18,20]);
});
