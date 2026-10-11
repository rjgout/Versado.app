import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateInventorySnapshot } from "../scripts/content-architecture/validate-inventory.mjs";
import { analyseIdentities, INTEGRITY_KEYS } from "../src/lib/content-inventory/core.ts";
const fixture = JSON.parse(readFileSync("tests/fixtures/content-1a-catalog.json","utf8"));
const sql = Buffer.from("SELECT 1;\n"), checksum = createHash("sha256").update(sql).digest("hex");
const migration = (name="test", hash=checksum) => ({migration_name:name,checksum:hash,started_at:"2026-10-10T10:00:00.000Z",finished_at:"2026-10-10T10:01:00.000Z",rolled_back_at:null,applied_steps_count:1});
function report() {
  const collections=fixture.collections.map(c=>({...c,publicationState:null}));
  return {formatVersion:3,capturedAt:fixture.capturedAt,readOnly:true,publicationFieldPresent:false,collections,
    identities:analyseIdentities(collections),counts:{...fixture.counts},integrity:Object.fromEntries(INTEGRITY_KEYS.map(k=>[k,"0"])),fsy:{...fixture.fsy},migrations:[migration()]};
}
test("echte catalogusmetadata: 21 edities, zeven werken, 6/15 zichtbaarheid; gedeelde analyse",()=>{
  const result=validateInventorySnapshot(report(),()=>sql);
  assert.deepEqual(result.blockers,[]); assert.equal(result.report.identities.works.length,7);
  assert.equal(result.report.collections.filter(c=>c.visibleToUsers).length,6);
  assert.equal(result.report.identities.works.find(w=>w.key==="podcasts").suggestedKind,"OTHER");
  assert.equal(result.report.fsy.drafts,"21");
});
test("onbetrouwbare analyse, dubbele ids en afwijkende counts worden geblokkeerd",()=>{
  const r=report();r.identities.works=[];r.collections[1].id=r.collections[0].id;r.counts.ContentCollection="20";
  const result=validateInventorySnapshot(r,()=>sql);
  for(const code of ["IDENTITY_ANALYSIS_MISMATCH","DUPLICATE_COLLECTION_ID","COLLECTION_COUNT_MISMATCH"]) assert.ok(result.blockers.includes(code));
  assert.throws(()=>validateInventorySnapshot({...r,formatVersion:2},()=>sql));
});
test("checksumdrift, ontbrekend SQL-bestand en onvoltooide migratie vereisen review",()=>{
  const r=report();r.migrations.push({...migration("unfinished"),finished_at:null});
  assert.ok(validateInventorySnapshot(r,()=>null).blockers.includes("CHECKSUM_REVIEW_REQUIRED:test"));
  assert.ok(validateInventorySnapshot(r,()=>Buffer.from("changed")).blockers.includes("UNFINISHED_MIGRATION:unfinished"));
});
test("historische rollback gevolgd door bewezen succes is geen actuele fout",()=>{
  const r=report();r.migrations.unshift({...migration(),checksum:"old-failed-version",finished_at:null,rolled_back_at:"2026-10-09T10:02:00.000Z",started_at:"2026-10-09T10:00:00.000Z"});
  assert.deepEqual(validateInventorySnapshot(r,()=>sql).blockers,[]);
  r.migrations.pop(); assert.ok(validateInventorySnapshot(r,()=>sql).blockers.includes("ROLLBACK_REVIEW_REQUIRED:test"));
});
test("historische hernoeming is alleen geldig met exacte oorspronkelijke én vervangende checksum",()=>{
  const r=report(); const old="1789767235_add_person_fields", replacement="20260918213534_add_person_fields";
  const replacementSql=readFileSync(`prisma/migrations/${replacement}/migration.sql`);
  r.migrations=[migration(old,"fd355a8e0d834ed93ef221c19356023f5557ea97871b0aa379421652b4487007"),migration(replacement,createHash("sha256").update(replacementSql).digest("hex"))];
  const loader=name=>name===replacement?replacementSql:null;
  assert.deepEqual(validateInventorySnapshot(r,loader).blockers,[]);
  r.migrations[0].checksum="different";assert.ok(validateInventorySnapshot(r,loader).blockers.includes(`CHECKSUM_REVIEW_REQUIRED:${old}`));
});
