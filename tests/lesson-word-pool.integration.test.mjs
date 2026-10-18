import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {referenceAccount,assertReferenceTestEnvironment} from './fixtures/reference-content.mjs';
import {appendStudyRevision} from '../src/lib/studyContent/revisions.ts';
import {resolveLessonWordPool} from '../src/lib/studyContent/wordPoolResolver.ts';
import {convertFsyLesson,fsyLegacyIdentity} from '../src/lib/studyContent/fsyConversion.ts';
assertReferenceTestEnvironment();
const options={minLength:3,maxLength:30,minCandidates:3,maxCandidates:100,blockTypes:['paragraph','list','quote','table','question']};
const body=words=>({schemaVersion:1,sections:[{id:'introduction',blocks:[{id:'paragraph',type:'paragraph',content:[{type:'text',text:words}]}]}]});
let admin,normal,collection,edition,first,second;
const request=(revisionId=first.id)=>({lessonEditionId:edition.id,revisionId,options});
before(async()=>{
 admin=await referenceAccount(true);normal=await referenceAccount();
 await prisma.contentWork.upsert({where:{key:'cfm'},create:{key:'cfm',kind:'STUDY_PROGRAM'},update:{}});
 const key='synthetic-cfm-pool-'+randomUUID();collection=await prisma.contentCollection.create({data:{id:key,slug:key,name:'Synthetische CFM 2026-testles',icon:'',work:'cfm',editionKey:key,language:'nl',visibleToUsers:true,publicationState:'PUBLISHED'}});
 const period=await prisma.studyPeriod.create({data:{workKey:'cfm',sourceKey:key,label:'Synthetisch 2026',year:2026}});
 const lesson=await prisma.studyLesson.create({data:{workKey:'cfm',periodId:period.id,sourceKey:'synthetic-official-lesson',order:1}});
 edition=await prisma.studyLessonEdition.create({data:{lessonId:lesson.id,collectionId:key,workKey:'cfm',slug:'synthetic-official-lesson'}});
 first=await appendStudyRevision(admin.actor,edition.id,{schemaVersion:1,title:'Synthetische les',body:body('geloof hoop naastenliefde vertrouwen schriftstudie'),sourceMetadata:{sourceKey:'synthetic:cfm:lesson'},rightsMetadata:{holder:'Testbron',permission:'Uitsluitend synthetische tests'}});
 await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:first.id}});
 const verse=await prisma.verse.findFirstOrThrow();await prisma.note.create({data:{userId:normal.user.id,verseId:verse.id,targetKey:'verse:'+verse.id,text:'Ongeoorloofdeprivépoolwoorden'}});
});after(()=>prisma.$disconnect());
test('Nederlandse gepubliceerde CFM-pool is exact gepind, reproduceerbaar en vrij van privédata',async()=>{
 const a=await resolveLessonWordPool(normal.actor,request()),b=await resolveLessonWordPool(normal.actor,request());assert.equal(a.available,true);assert.deepEqual(a,b);assert.equal(a.context.collectionId,collection.id);assert.equal(a.context.lessonEditionId,edition.id);assert.equal(a.context.revisionId,first.id);assert.equal(a.context.contentLanguage,'nl');assert.equal(a.context.normalizationVersion,1);assert.match(a.context.poolHash,/^[a-f0-9]{64}$/);assert.equal(a.candidates.some(c=>c.word==='ongeoorloofdeprivépoolwoorden'),false);assert.ok(Object.isFrozen(a.context));
});
test('alle oude tabellen blijven readonly: geen voorkeur, voortgang, hint, XP of annotatiemutatie',async()=>{
 const tables=await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename`;
 async function fingerprints(){const rows=[];for(const {tablename} of tables){const q='"'+tablename.replaceAll('"','""')+'"';rows.push([tablename,await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM ${q} t`)]);}return rows;}
 const old=await fingerprints();await resolveLessonWordPool(normal.actor,request());assert.deepEqual(await fingerprints(),old);
});
test('nieuwe publicatie verandert poolidentiteit; historische aanvraag wordt niet naar nieuw omgeleid; rollback herstelt exacte oude hash',async()=>{
 const original=await resolveLessonWordPool(normal.actor,request());
 second=await appendStudyRevision(admin.actor,edition.id,{schemaVersion:1,title:'Nieuw synthetisch concept',body:body('vriendelijkheid hoop zachtmoedigheid vertrouwen'),sourceMetadata:{sourceKey:'synthetic:cfm:lesson'},rightsMetadata:{holder:'Testbron',permission:'Uitsluitend synthetische tests'}});
 assert.equal((await resolveLessonWordPool(normal.actor,request(second.id))).reason,'revision');
 await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:second.id}});
 assert.deepEqual(await resolveLessonWordPool(normal.actor,request()),{available:false,reason:'revision'});
 const updated=await resolveLessonWordPool(normal.actor,request(second.id));assert.equal(updated.available,true);assert.notEqual(updated.context.poolHash,original.context.poolHash);
 await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:first.id}});
 assert.equal((await resolveLessonWordPool(normal.actor,request())).context.poolHash,original.context.poolHash);
});
test('DRAFT, disabled, ingetrokken en ontbrekende edities geven geen woorden; verborgen bron volgt normale adminrechten',async()=>{
 assert.equal((await resolveLessonWordPool(null,request())).available,false);
 for(const patch of [{publicationState:'DRAFT'},{enabled:false},{visibleToUsers:false}]){
  await prisma.contentCollection.update({where:{id:collection.id},data:patch});
  assert.equal((await resolveLessonWordPool(normal.actor,request())).available,false);
  const a=await resolveLessonWordPool(admin.actor,request());assert.equal(a.available,'visibleToUsers' in patch);
  assert.equal('candidates' in await resolveLessonWordPool(normal.actor,request()),false);
  await prisma.contentCollection.update({where:{id:collection.id},data:{publicationState:'PUBLISHED',enabled:true,visibleToUsers:true}});
 }
 await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:null}});assert.equal((await resolveLessonWordPool(admin.actor,request())).available,false);
 await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:first.id}});
 assert.equal((await resolveLessonWordPool(normal.actor,{...request(),lessonEditionId:'missing'})).available,false);
 await prisma.studyLesson.update({where:{id:edition.lessonId},data:{retiredAt:new Date()}});assert.equal((await resolveLessonWordPool(normal.actor,request())).available,false);await prisma.studyLesson.update({where:{id:edition.lessonId},data:{retiredAt:null}});
});
test('taal, onjuiste revisie en vervalste payload krijgen geen bron-/userfallback',async()=>{
 for(const extra of [{userId:admin.user.id},{collectionId:'content_bom'},{visitProof:'historical-proof'},{language:'en'}])assert.equal((await resolveLessonWordPool(normal.actor,{...request(),...extra})).available,false);
 await prisma.contentCollection.update({where:{id:collection.id},data:{language:'xx'}});assert.deepEqual(await resolveLessonWordPool(normal.actor,request()),{available:false,reason:'language'});
 await prisma.contentCollection.update({where:{id:collection.id},data:{language:'nl'}});
 assert.equal((await resolveLessonWordPool(normal.actor,{...request(),revisionId:'missing'})).reason,'revision');
 assert.equal((await resolveLessonWordPool(normal.actor,{...request(),options:{...options,minCandidates:20}})).reason,'pool');
});
test('gepubliceerde synthetische FSY-copy uit de echte 3C-adapter levert een afzonderlijke pool',async()=>{
 const key='synthetic-fsy-pool-'+randomUUID();await prisma.contentCollection.create({data:{id:key,slug:key,name:'Synthetische FSY',icon:'',work:'fsy',editionKey:key,language:'nl',publicationState:'LEGACY',visibleToUsers:true,sourceName:'Synthetische bronhouder',licenseName:'Synthetische toestemming'}});
 const content=JSON.stringify([{type:'paragraph',text:'moed vertrouwen geloof verdraagzaamheid'}]);
 const row=await prisma.fsyLesson.create({data:{contentCollectionId:key,year:2026,month:5,category:'gospel',slug:key,title:'Synthetische FSY',content,images:'[]',sourceUrl:`https://www.churchofjesuschrist.org/study/ftsoy/2026/05/${key}?lang=nld`,sourceHash:'f'.repeat(64),publishedTitle:'Synthetische FSY',publishedContent:content,publishedImages:'[]',publishedAt:new Date(),status:'PUBLISHED'}});
 const converted=await convertFsyLesson(admin.actor,row.id,{expectedLegacyHash:fsyLegacyIdentity(row),actionId:randomUUID(),confirm:'CONVERT_EXISTING_FSY'});
 const e=await prisma.studyLessonEdition.findUniqueOrThrow({where:{id:converted.editionId}});
 const pool=await resolveLessonWordPool(normal.actor,{lessonEditionId:e.id,revisionId:e.publishedRevisionId,options});assert.equal(pool.available,true);assert.equal(pool.context.workKey,'fsy');assert.equal(pool.context.collectionId,key);assert.ok(pool.candidates.some(c=>c.word==='verdraagzaamheid'));
 assert.equal((await resolveLessonWordPool(normal.actor,{lessonEditionId:e.id,revisionId:first.id,options})).reason,'revision');
});
test('constante, begrensde querykosten zonder N+1 of globale cache',async()=>{
 const {PrismaClient}=await import('../src/generated/prisma/client.ts'),{PrismaPg}=await import('@prisma/adapter-pg');
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL}),log:[{emit:'event',level:'query'}]});let count=0;db.$on('query',()=>count++);
 try{await db.$queryRaw`SELECT 1`;count=0;const result=await resolveLessonWordPool(normal.actor,request(),db);assert.equal(result.available,true);assert.ok(count<=12,`maximaal 12 queries inclusief transactie, gemeten ${count}`);console.log(JSON.stringify({lessonWordPoolQueries:count,scope:'isolated-test-only'}));}finally{await db.$disconnect();}
});
test('een echte Engelse testeditie blijft afzonderlijk, zonder taal- of editieomleiding',async()=>{
 const key='english-pool-'+randomUUID();
 await prisma.contentCollection.create({data:{id:key,slug:key,name:'Synthetic English study edition',icon:'',work:'cfm',editionKey:collection.editionKey,language:'en',publicationState:'PUBLISHED',visibleToUsers:true}});
 const e=await prisma.studyLessonEdition.create({data:{lessonId:edition.lessonId,collectionId:key,workKey:'cfm',slug:'synthetic-official-lesson'}});
 const r=await appendStudyRevision(admin.actor,e.id,{schemaVersion:1,title:'Synthetic English lesson',body:body('faith patience charity kindness'),sourceMetadata:{sourceKey:'synthetic:cfm:lesson'},rightsMetadata:{holder:'Test source',permission:'Synthetic tests only'}});
 await prisma.studyLessonEdition.update({where:{id:e.id},data:{publishedRevisionId:r.id}});
 const pool=await resolveLessonWordPool(normal.actor,{lessonEditionId:e.id,revisionId:r.id,options});assert.equal(pool.available,true);assert.equal(pool.context.contentLanguage,'en');assert.equal(pool.context.lessonId,edition.lessonId);assert.ok(pool.candidates.some(c=>c.word==='faith'));assert.equal(pool.candidates.some(c=>c.word==='geloof'),false);
 assert.equal((await resolveLessonWordPool(normal.actor,{...request(),revisionId:r.id})).reason,'revision');
});
