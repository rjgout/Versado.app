import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db.ts";
import { mutateAnnotation, getAnnotation, listAnnotations, legacyVerseAnnotation } from "../src/lib/annotations/service.ts";
import { passageBlocks } from "../src/lib/annotations/contract.ts";
import { appendStudyRevision } from "../src/lib/studyContent/revisions.ts";
import { referenceFixture, referenceAccount, assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";
assertReferenceTestEnvironment();
let f, target, verseId;
const command=(kind, target, expectedVersion=0, extra={})=>({kind,target,expectedVersion,actionId:randomUUID(),...(kind==='note'?{text:'Privétestnotitie'}:{}),...extra});
const fault=code=>error=>error.code===code;
const http=(path,method='GET',body,who=f.owner,origin=f.base)=>fetch(f.base+path,{method,headers:{...(who?{Cookie:who.cookie}:{}),...(method==='GET'?{}:{Origin:origin,'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
async function state(userId){
 const tables=await prisma.$queryRaw`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='userId' AND table_name NOT IN ('Bookmark','Highlight','Note') ORDER BY table_name`;
 const hashes=[];
 for(const {table_name:name} of tables){assert.match(name,/^[A-Za-z0-9_]+$/);hashes.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM "${name}" t WHERE "userId"=$1`,userId));}
 return {user:await prisma.user.findUniqueOrThrow({where:{id:userId}}),hashes};
}
before(async()=>{
 f=await referenceFixture();
 const section=f.dto.lesson.body.sections[0], block=passageBlocks(f.dto.lesson.body,section.id)[0];
 target={type:'lesson',lessonEditionId:f.item.lessonEditionId,revisionId:f.item.revisionId,selector:{normalizationVersion:1,originalRevisionId:f.item.revisionId,sectionAnchor:section.id,ranges:[{blockId:block.id,start:0,end:[...block.text].length}],exact:block.text,prefix:'',suffix:''}};
 verseId=(await prisma.verse.findFirstOrThrow({where:{chapter:{book:{contentCollectionId:'content_bom'}}}})).id;
});
after(()=>prisma.$disconnect());
test('Bookmark, Highlight en Note op gepubliceerde passage; eigen gegevens en alle voortgang/economie behouden',async()=>{
 const before=await state(f.owner.user.id);
 for(const kind of ['bookmark','highlight','note']){
  const action=command(kind,target,0,kind==='highlight'?{color:'blue'}:{});
  const first=await mutateAnnotation(f.owner.actor,action);
  assert.equal(first.changed,true);assert.equal(first.annotation.mutationVersion,1);
  assert.equal(first.annotation.target.revisionId,target.revisionId);
  const retry=await mutateAnnotation(f.owner.actor,action);assert.equal(retry.changed,false);assert.deepEqual(retry.annotation,first.annotation);
  assert.deepEqual(await getAnnotation(f.owner.actor,kind,first.annotation.id),first.annotation);
 }
 assert.equal((await listAnnotations(f.owner.actor,{lessonEditionId:target.lessonEditionId})).length,3);
 assert.deepEqual(await state(f.owner.user.id),before);
});
test('gelijktijdig eerste aanmaak en wijzigingen; verloren responses, ongeldige actionId-herhaling en oude retry',async()=>{
 const who=await referenceAccount();const a=command('note',target),b=command('note',target,0,{text:'Ander toestel'});
 const create=await Promise.allSettled([mutateAnnotation(who.actor,a),mutateAnnotation(who.actor,b)]);
 assert.equal(create.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(create.find(r=>r.status==='rejected').reason.code,'CONFLICT');
 const winner=create[0].status==='fulfilled'?a:b;
 const row=create.find(r=>r.status==='fulfilled').value.annotation;
 assert.equal((await mutateAnnotation(who.actor,winner)).changed,false);
 await assert.rejects(mutateAnnotation(who.actor,{...winner,text:'Zelfde actionId, andere payload'}),fault('INVALID'));
 const changes=await Promise.allSettled([mutateAnnotation(who.actor,command('note',target,1,{text:'Versie A'})),mutateAnnotation(who.actor,command('note',target,1,{text:'Versie B'}))]);
 assert.equal(changes.filter(r=>r.status==='fulfilled').length,1);assert.equal(changes.find(r=>r.status==='rejected').reason.state.mutationVersion,2);
 await assert.rejects(mutateAnnotation(who.actor,winner),fault('CONFLICT'));
 const remove=command('note',target,2);delete remove.text;
 const deletes=await Promise.all([mutateAnnotation(who.actor,remove,true),mutateAnnotation(who.actor,remove,true)]);
 assert.equal(deletes.filter(r=>r.changed).length,1);assert.ok(deletes.every(r=>r.annotation.deleted&&r.annotation.mutationVersion===3&&r.annotation.text===''));
 assert.equal((await listAnnotations(who.actor,{lessonEditionId:target.lessonEditionId})).length,0);
 const replay=await mutateAnnotation(who.actor,command('note',target,3,{text:'Bewuste heraanmaak'}));
 assert.equal(replay.annotation.id,row.id);assert.equal(replay.annotation.mutationVersion,4);
 await assert.rejects(mutateAnnotation(who.actor,remove,true),fault('CONFLICT'));
 await assert.rejects(mutateAnnotation(who.actor,winner),fault('CONFLICT'));
 assert.equal((await getAnnotation(who.actor,'note',row.id)).text,'Bewuste heraanmaak');
});
test('DELETE van afwezige annotatie is veilig; oude DELETE kan latere aanmaak niet verwijderen',async()=>{
 const who=await referenceAccount(), action=command('bookmark',target);
 assert.deepEqual(await mutateAnnotation(who.actor,action,true),{changed:false,annotation:null});
 const created=await mutateAnnotation(who.actor,command('bookmark',target));
 await assert.rejects(mutateAnnotation(who.actor,action,true),fault('CONFLICT'));
 assert.equal((await getAnnotation(who.actor,'bookmark',created.annotation.id)).deleted,false);
});
test('cross-user, adminprivileges, gemanipuleerde userId en Origin/sessie geven geen privétoegang',async()=>{
 const who=await referenceAccount();const saved=await mutateAnnotation(who.actor,command('note',target));
 for(const other of [f.owner,f.admin]){
  await assert.rejects(getAnnotation(other.actor,'note',saved.annotation.id),fault('UNAVAILABLE'));
  const response=await http(`/api/annotations?kind=note&id=${saved.annotation.id}`,'GET',undefined,other);assert.equal(response.status,404);
 }
 assert.equal((await http('/api/annotations','PUT',command('bookmark',target),null)).status,401);
 assert.equal((await http('/api/annotations','PUT',command('bookmark',target),who,'https://evil.invalid')).status,403);
 assert.equal((await http('/api/annotations','PUT',{...command('bookmark',target),userId:f.owner.user.id},who)).status,400);
 assert.equal((await http(`/api/annotations?lessonEditionId=${target.lessonEditionId}&userId=${who.user.id}`,'GET',undefined,who)).status,400);
 const response=await http(`/api/annotations?kind=note&id=${saved.annotation.id}`,'GET',undefined,who);
 assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.ok(response.headers.get('vary').split(',').some(value=>value.trim().toLowerCase()==='cookie'));
 assert.equal(JSON.stringify(await response.json()).includes('body'),false);
});
test('echte HTTP PUT/DELETE zijn idempotent, geven herstelbare 409 en begrenzen payload',async()=>{
 const who=await referenceAccount(), action=command('note',target);
 const created=await http('/api/annotations','PUT',action,who);assert.equal(created.status,200);const first=await created.json();
 const retry=await http('/api/annotations','PUT',action,who);assert.equal(retry.status,200);assert.equal((await retry.json()).changed,false);
 const stale=await http('/api/annotations','PUT',command('note',target),who);assert.equal(stale.status,409);assert.equal((await stale.json()).state.id,first.annotation.id);
 const remove=command('note',target,1);delete remove.text;
 const responses=await Promise.all([http('/api/annotations','DELETE',remove,who),http('/api/annotations','DELETE',remove,who)]);
 assert.ok(responses.every(r=>r.status===200));assert.equal((await responses[0].json()).annotation.mutationVersion,2);
 assert.equal((await http('/api/annotations','PUT',{...action,text:'x'.repeat(140000)},who)).status,400);
 assert.equal((await http(`/api/annotations?kind=note&kind=bookmark&id=${first.annotation.id}`,'GET',undefined,who)).status,400);
});
test('verborgen vrijgegeven inhoud is alleen voor beheer toegankelijk; DRAFT/disabled voor niemand',async()=>{
 try{
  await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:false}});
  await assert.rejects(mutateAnnotation((await referenceAccount()).actor,command('bookmark',target)),fault('UNAVAILABLE'));
  assert.equal((await mutateAnnotation(f.admin.actor,command('bookmark',target))).changed,true);
  for(const change of [{publicationState:'DRAFT'},{publicationState:'PUBLISHED',enabled:false}]){
   await prisma.contentCollection.update({where:{id:f.collection.id},data:change});
   for(const isAdmin of [false,true])await assert.rejects(mutateAnnotation((await referenceAccount(isAdmin)).actor,command('bookmark',target)),fault('UNAVAILABLE'));
  }
 }finally{await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:true,enabled:true,publicationState:'PUBLISHED'}});}
});
test('ingetrokken bron behoudt eigen notitie, lekt geen nieuwe brontekst en laat bewuste verwijdering toe',async()=>{
 const who=await referenceAccount();const saved=await mutateAnnotation(who.actor,command('note',target));
 try{
  await prisma.contentCollection.update({where:{id:f.collection.id},data:{enabled:false}});
  assert.equal((await getAnnotation(who.actor,'note',saved.annotation.id)).text,'Privétestnotitie');
  assert.equal((await listAnnotations(who.actor,{lessonEditionId:target.lessonEditionId})).length,1);
  await assert.rejects(mutateAnnotation(who.actor,command('note',target,1)),fault('UNAVAILABLE'));
  const remove=command('note',target,1);delete remove.text;
  assert.equal((await mutateAnnotation(who.actor,remove,true)).annotation.deleted,true);
 }finally{await prisma.contentCollection.update({where:{id:f.collection.id},data:{enabled:true}});}
});
test('verkeerde revisie/editie en corrupte selectors worden zonder write geweigerd',async()=>{
 const who=await referenceAccount();
 for(const candidate of [{...targetForTest(),lessonEditionId:'unknown'},{...targetForTest(),revisionId:'wrong',selector:{...target.selector,originalRevisionId:'wrong'}},{...targetForTest(),selector:{...target.selector,exact:'Vervalst'}}])await assert.rejects(mutateAnnotation(who.actor,command('note',candidate)),error=>['INVALID','UNAVAILABLE'].includes(error.code));
 assert.equal(await prisma.note.count({where:{userId:who.user.id}}),0);
 function targetForTest(){return structuredClone(target);}
});
test('draft en historische revisie blijven buiten writes, ook met geldig eerder leesbezoektoken',async()=>{
 const who=await referenceAccount(), old=await prisma.studyRevision.findUniqueOrThrow({where:{id:target.revisionId}});
 const newer=await appendStudyRevision(f.admin.actor,target.lessonEditionId,{schemaVersion:1,title:'Nieuwere synthetische revisie',body:old.body,sourceMetadata:old.sourceMetadata,rightsMetadata:old.rightsMetadata});
 const nextTarget={...target,revisionId:newer.id,selector:{...target.selector,originalRevisionId:newer.id}};
 await assert.rejects(mutateAnnotation(who.actor,command('note',nextTarget)),fault('UNAVAILABLE'));
 try{
  await prisma.studyLessonEdition.update({where:{id:target.lessonEditionId},data:{publishedRevisionId:newer.id}});
  await assert.rejects(mutateAnnotation(who.actor,command('note',target)),fault('UNAVAILABLE'));
  await assert.rejects(mutateAnnotation(who.actor,{...command('note',target),visitProof:f.dto.visitProof}),fault('INVALID'));
  assert.equal((await mutateAnnotation(who.actor,command('note',nextTarget))).changed,true);
 }finally{await prisma.studyLessonEdition.update({where:{id:target.lessonEditionId},data:{publishedRevisionId:old.id}});}
});
test('publicatiepointerwissel wordt onder dezelfde editielock afgewacht en opnieuw gevalideerd',async()=>{
 const who=await referenceAccount(), old=await prisma.studyRevision.findUniqueOrThrow({where:{id:target.revisionId}});
 const newer=await appendStudyRevision(f.admin.actor,target.lessonEditionId,{schemaVersion:1,title:'Concurrente revisie',body:old.body,sourceMetadata:old.sourceMetadata,rightsMetadata:old.rightsMetadata});
 let entered,release;const locked=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const publication=prisma.$transaction(async db=>{
  await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${target.lessonEditionId} FOR UPDATE`;
  await db.studyLessonEdition.update({where:{id:target.lessonEditionId},data:{publishedRevisionId:newer.id}});
  entered();await gate;
 },{timeout:10000});
 try{
  await locked;let done=false;
  const save=mutateAnnotation(who.actor,command('note',target)).then(v=>{done=true;return v;},e=>{done=true;throw e;});
  const rejected=assert.rejects(save,fault('UNAVAILABLE'));await delay(75);assert.equal(done,false);
  release();await publication;await rejected;
  assert.equal(await prisma.note.count({where:{userId:who.user.id}}),0);
 }finally{release();await publication;await prisma.studyLessonEdition.update({where:{id:target.lessonEditionId},data:{publishedRevisionId:old.id}});}
});
test('legacy toggles, notitiecontracten en /api/bookmarks blijven uitsluitend verse-only',async()=>{
 const who=await referenceAccount(), verse={type:'verse',verseId};
 for(const kind of ['bookmark','highlight']){
  const route=`/api/verses/${verseId}/${kind}`, field=kind==='bookmark'?'bookmarked':'highlighted';
  assert.deepEqual(await (await http(route,'POST',undefined,who)).json(),{[field]:true});
  assert.deepEqual(await (await http(route,'POST',undefined,who)).json(),{[field]:false});
  assert.deepEqual(await (await http(route,'POST',undefined,who)).json(),{[field]:true});
 }
 assert.deepEqual(await(await http(`/api/verses/${verseId}/note`,'PUT',{text:'Versnotitie'},who)).json(),{note:'Versnotitie'});
 assert.deepEqual(await(await http(`/api/verses/${verseId}/note`,'PUT',{text:''},who)).json(),{note:null});
 const result=await mutateAnnotation(who.actor,command('note',verse,2,{text:'Gedeelde writer'}));assert.equal(result.annotation.mutationVersion,3);
 assert.equal((await legacyVerseAnnotation(who.actor,'note',verseId,'Legacy writer')).mutationVersion,4);
 await mutateAnnotation(who.actor,command('bookmark',target));
 const list=await http('/api/bookmarks','GET',undefined,who);assert.equal(list.status,200);const bookmarks=await list.json();
 assert.equal(bookmarks.length,1);assert.equal(bookmarks[0].verseId,verseId);assert.ok(bookmarks[0].text);
});
test('database dedupe, samengestelde revisie-FK en target-XOR beschermen beide targetsoorten',async()=>{
 const who=await referenceAccount(), saved=await mutateAnnotation(who.actor,command('bookmark',target));
 const row=await prisma.bookmark.findUniqueOrThrow({where:{id:saved.annotation.id}});
 await assert.rejects(prisma.bookmark.create({data:{...row,id:randomUUID()}}));
 await assert.rejects(prisma.bookmark.update({where:{id:row.id},data:{verseId}}));
 await assert.rejects(prisma.bookmark.update({where:{id:row.id},data:{lessonEditionId:'missing'}}));
 const other=await referenceFixture('en');
 await assert.rejects(prisma.bookmark.update({where:{id:row.id},data:{revisionId:other.item.revisionId,selector:{...target.selector,originalRevisionId:other.item.revisionId}}}));
 assert.equal((await prisma.bookmark.findUniqueOrThrow({where:{id:row.id}})).revisionId,target.revisionId);
 await assert.rejects(mutateAnnotation(who.actor,command('note',{...target,lessonEditionId:other.item.lessonEditionId})),fault('UNAVAILABLE'));
});
test('technische rollbackstand blokkeert nieuwe passagewrites maar behoudt privéreadback, DELETE en versadapters',async()=>{
 const who=await referenceAccount(), saved=await mutateAnnotation(who.actor,command('note',target));
 const original=process.env.STUDY_ANNOTATION_WRITES;
 try{
  process.env.STUDY_ANNOTATION_WRITES='0';
  await assert.rejects(mutateAnnotation(who.actor,command('note',target,1)),fault('UNAVAILABLE'));
  assert.equal((await getAnnotation(who.actor,'note',saved.annotation.id)).text,'Privétestnotitie');
  assert.equal((await legacyVerseAnnotation(who.actor,'bookmark',verseId)).deleted,false);
  const remove=command('note',target,1);delete remove.text;
  assert.equal((await mutateAnnotation(who.actor,remove,true)).annotation.deleted,true);
 }finally{if(original===undefined)delete process.env.STUDY_ANNOTATION_WRITES;else process.env.STUDY_ANNOTATION_WRITES=original;}
});
test('concrete taaleditie blijft deel van de identiteit en wordt niet stilzwijgend vervangen',async()=>{
 const who=await referenceAccount();
 const key='annotation-en-'+randomUUID();
 const collection=await prisma.contentCollection.create({data:{id:key,slug:key,name:'Synthetische Engelse editie',icon:'',work:f.collection.work,editionKey:f.collection.editionKey,language:'en',enabled:true,visibleToUsers:true,publicationState:'PUBLISHED'}});
 const edition=await prisma.studyLessonEdition.create({data:{lessonId:f.item.edition.lessonId,collectionId:collection.id,workKey:f.collection.work,slug:'english-fixture'}});
 const original=await prisma.studyRevision.findUniqueOrThrow({where:{id:target.revisionId}});
 const revision=await appendStudyRevision(f.admin.actor,edition.id,{schemaVersion:1,title:'Synthetische Engelse revisie',body:original.body,sourceMetadata:original.sourceMetadata,rightsMetadata:original.rightsMetadata});
 await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:revision.id}});
 await assert.rejects(mutateAnnotation(who.actor,command('note',{...target,lessonEditionId:edition.id})),fault('UNAVAILABLE'));
 const correct={...target,lessonEditionId:edition.id,revisionId:revision.id,selector:{...target.selector,originalRevisionId:revision.id}};
 const saved=await mutateAnnotation(who.actor,command('note',correct));assert.equal(saved.annotation.target.lessonEditionId,edition.id);
 assert.equal((await listAnnotations(who.actor,{lessonEditionId:target.lessonEditionId})).length,0);
});
