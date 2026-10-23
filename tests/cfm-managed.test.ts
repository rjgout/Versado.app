import { StudyPublishingError } from "../src/lib/studyContent/policy";
import fs from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { cfmApprovedSnapshot, requireCfmApproval } from "../src/lib/studyContent/sourceApproval";
import { cfmDisplayOnlyKeys, cfmReviewedDisplayOnlyKeys } from "../src/lib/studyContent/cfmReview";
import { loadCfmLesson } from "../src/lib/studyContent/cfm2026Import";
import { cfmSnapshotItem } from "../src/lib/studyContent/cfm2026Adapter";

test("snapshotgoedkeuring is exact, gedeeld met CLI en een gewijzigde/onbekende snapshot wordt geweigerd", async()=>{
  const pin=await cfmApprovedSnapshot();assert.match(pin,/^[a-f0-9]{64}$/);await requireCfmApproval(pin);
  await assert.rejects(requireCfmApproval("0".repeat(64)),e=>e instanceof StudyPublishingError && e.code === "CONFLICT");
});
test("alle 52 lessen behouden 3200 blokken; alleen de 553 exact beoordeelde verwijzingen kunnen inactief blijven",async()=>{
 let blocked=0,blocks=0;
 for(let i=1;i<=52;i++){
  const parsed=await loadCfmLesson(String(i).padStart(2,"0"));blocks+=parsed.inventory.blockCount;
  const item=cfmSnapshotItem(parsed,()=>Buffer.alloc(0));
  const keys=await cfmReviewedDisplayOnlyKeys(item.sourceKey,item);blocked+=keys.length;const permitted=await cfmDisplayOnlyKeys(item.sourceKey,item);assert.ok(keys.every(k=>permitted.includes(k)),"de beoordeelde verwijzingen blijven toegestaan");
  if(i===1){await assert.rejects(cfmDisplayOnlyKeys(item.sourceKey,{...item,title:"Gewijzigde ongereviewde inhoud"}));await assert.rejects(cfmDisplayOnlyKeys(item.sourceKey,item,"0".repeat(64)));}
 }
 assert.equal(blocked,553);assert.equal(blocks,3200);
});

test("een nieuwe bronsnapshot vereist opnieuw expliciete goedkeuring",async(t)=>{const old=await cfmApprovedSnapshot();const read=fs.readFile.bind(fs);t.mock.method(fs,"readFile",async(...args: Parameters<typeof fs.readFile>)=>{const bytes=await read(...args);return String(args[0]).endsWith("source-lock.json") ? Buffer.concat([Buffer.from(bytes),Buffer.from("\n")]) : bytes;});const next=await cfmApprovedSnapshot();assert.notEqual(next,old);await assert.rejects(requireCfmApproval(old));await requireCfmApproval(next);t.mock.restoreAll();await requireCfmApproval(old);});
