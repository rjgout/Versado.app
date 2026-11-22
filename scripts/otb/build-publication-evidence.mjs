// Alleen bewijsbestanden schrijven; geen databaseverbinding, import of publicatie.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {validateSource} from './validate.ts';
import {OTB_COLLECTIONS,otbWorkForBookNumber} from './trialConfig.ts';
import {publicationTextEvidence,publicationObjectHash} from './publicationEvidence.ts';
const root=process.argv[2];assert.ok(root,'Geef een schone checkout van de gepinde bron');
const lock=JSON.parse(readFileSync('scripts/otb/source-lock.json','utf8'));
assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),lock.upstreamCommit);
assert.equal(execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
const license=readFileSync(join(root,'LICENCE.md'),'utf8');
assert.match(license,/Attribution-ShareAlike 4\.0/);
assert.match(license,/creativecommons\.org\/licenses\/by-sa\/4\.0/);
const validated=await validateSource(root);
assert.deepEqual(validated.issues,[]);assert.equal(validated.skeletonsEqual,true);
const editions=OTB_COLLECTIONS.map(collection=>{
 const scan=validated.scans.find(item=>item.locale===collection.locale);
 const books=[...scan.books].filter(([,book])=>otbWorkForBookNumber(book.number)===collection.work).map(([key,book])=>({
  key,slug:`${collection.work}-otb-${collection.language}-${key}`,name:book.name,order:book.number-1,
  chapters:[...book.chapters].map(([number,verses])=>({number,order:number-1,verses:[...verses].map(([number,text])=>({number,text}))}))
 }));
 const evidence=publicationTextEvidence(books);assert.equal(evidence.books,collection.work==='old-testament'?39:27);
 assert.equal(evidence.chapters,collection.work==='old-testament'?929:260);
 return {id:collection.id,work:collection.work,language:collection.language,...evidence};
});
const manifest={schemaVersion:1,upstreamCommit:lock.upstreamCommit,sourceLockHash:publicationObjectHash(lock),licenseSha256:publicationObjectHash(license),editions};
writeFileSync(resolve('scripts/otb/publication-evidence.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(editions.map(({id,books,chapters,verses})=>({id,books,chapters,verses})),null,2));
