import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {referenceAccount, assertReferenceTestEnvironment} from './fixtures/reference-content.mjs';
import {convertFsyLesson,reviewFsyConversion,rollbackFsyWriter,fsyLegacyIdentity,requireFsyPublicationSource} from '../src/lib/studyContent/fsyConversion.ts';
import {getPublishedStudyLesson} from '../src/lib/studyContent/revisions.ts';
import {publishStudyRevision} from '../src/lib/studyContent/publication.ts';
import {getStudyContext,setStudyContext} from '../src/lib/studyContext.ts';
import {validateStudyImage, installStudyMedia} from '../src/lib/studyContent/storage.ts';
import {FIXTURE_IMAGE} from '../src/lib/studyContent/fixtureAdapter.ts';
import {publishFsyLesson} from '../src/lib/fsyContent.ts';
const base=assertReferenceTestEnvironment();
let admin, normal, collection;
before(async()=>{
 admin=await referenceAccount(true);normal=await referenceAccount();
 await prisma.contentWork.upsert({where:{key:'fsy'},create:{key:'fsy',kind:'STUDY_PROGRAM'},update:{}});
 const id='fsy-conversion-'+randomUUID();
 collection=await prisma.contentCollection.create({data:{id,slug:id,name:'Synthetische FSY',icon:'',work:'fsy',language:'nl',editionKey:id,publicationState:'LEGACY',visibleToUsers:true,sourceName:'Synthetische bronhouder',licenseName:'Synthetische testtoestemming'}});
});
after(()=>prisma.$disconnect());
export async function lesson(overrides={}) {
 const slug=randomUUID();
 return prisma.fsyLesson.create({data:{contentCollectionId:collection.id,year:2026,month:5,category:'gospel',slug,title:'Nieuwe titel',content:JSON.stringify([{type:'heading',text:'Kop'}, {type:'paragraph',text:'Exacte tekst é 日本語.'},{type:'list-item',text:'Eén punt'},{type:'quote',text:'Een citaat'}]),images:'[]',sourceUrl:`https://www.churchofjesuschrist.org/study/ftsoy/2026/05/${slug}?lang=nld`,sourceHash:'b'.repeat(64),lastScrapedAt:new Date('2025-01-02T03:04:05.678Z'),...overrides}});
}
const action=row=>({expectedLegacyHash:fsyLegacyIdentity(row),actionId:randomUUID(),confirm:'CONVERT_EXISTING_FSY'});
const pub={publishedTitle:'Oude titel',publishedContent:JSON.stringify([{type:'paragraph',text:'Exact oude gepubliceerde tekst.'}]),publishedImages:'[]',publishedAt:new Date('2024-06-07T08:09:10.123Z'),status:'DRAFT'};
async function edition(id){return prisma.studyLessonEdition.findUniqueOrThrow({where:{id},include:{lesson:{include:{period:true}},publishedRevision:true,draftRevision:true}});}
async function personal(){const names=['user','userStudyContext','userCourseProgress','contentProgress','readingPosition','bookmark','highlight','note','readingSession','podcastPlaybackProgress','activityFeed'];const result={};for(const n of names) if(prisma[n])result[n]=await prisma[n].findMany();return JSON.stringify(result);}

test('gepubliceerd plus gewijzigd concept: exacte teksten, echte maand/categorie, IDs/timestamps en persoonlijke data behouden',async()=>{
 const row=await lesson(pub), before=await personal();
 const review=await reviewFsyConversion(admin.actor,row.id);assert.equal(review.ready,true);assert.deepEqual(review.issues,['LEGACY_INLINE_LINKS_NOT_RECONSTRUCTED']);
 const result=await convertFsyLesson(admin.actor,row.id,action(row));const e=await edition(result.editionId);
 assert.equal(e.lesson.month,5);assert.equal(e.lesson.startsOn,null);assert.equal(e.lesson.endsOnExclusive,null);assert.equal(e.lesson.categoryKey,'gospel');assert.equal(e.lesson.period.year,2026);assert.equal(e.lesson.sourceKey,'fsy:'+row.id);
 assert.notEqual(e.publishedRevisionId,e.draftRevisionId);assert.equal(e.publishedRevision.title,'Oude titel');assert.equal(e.publishedRevision.body.sections[0].blocks[0].content[0].text,'Exact oude gepubliceerde tekst.');assert.equal(e.draftRevision.title,row.title);
 const stored=await prisma.fsyLesson.findUniqueOrThrow({where:{id:row.id}});assert.deepEqual({...stored,studyLessonEditionId:null},row);assert.equal(await personal(),before);
 const dto=await getPublishedStudyLesson(normal.actor,e.lessonId,collection.id);assert.equal(dto.revisionId,e.publishedRevisionId);
 await assert.rejects(publishFsyLesson(prisma,row.id),/FSY_STUDY_WRITER_ACTIVE/);
 await assert.rejects(prisma.fsyLesson.update({where:{id:row.id},data:{content:'[]'}}),/FSY_STUDY_WRITER_ACTIVE/);
 await assert.rejects(prisma.fsyLesson.delete({where:{id:row.id}}),/FSY_STUDY_WRITER_ACTIVE/);
 await assert.rejects(prisma.studyLessonEdition.delete({where:{id:e.id}}));
 await assert.rejects(lesson({studyLessonEditionId:e.id}),/FSY_STUDY_MAPPING_INVALID/);
 await assert.rejects(prisma.fsyLesson.update({where:{id:(await lesson()).id},data:{studyLessonEditionId:e.id}}),/FSY_STUDY_MAPPING_INVALID/);
});
test('alleen gepubliceerd krijgt één revisie, alleen concept blijft uitsluitend concept',async()=>{
 const row=await lesson({...pub,title:pub.publishedTitle,content:pub.publishedContent,images:pub.publishedImages,status:'PUBLISHED'});
 const r=await convertFsyLesson(admin.actor,row.id,action(row));const e=await edition(r.editionId);
 assert.ok(e.publishedRevisionId);assert.equal(e.draftRevisionId,null);assert.equal(await prisma.studyRevision.count({where:{lessonEditionId:e.id}}),1);
 const draft=await lesson();const d=await convertFsyLesson(admin.actor,draft.id,action(draft));const de=await edition(d.editionId);
 assert.equal(de.publishedRevisionId,null);assert.ok(de.draftRevisionId);assert.equal(await getPublishedStudyLesson(admin.actor,de.lessonId,collection.id),null);
});
test('onvolledige bron, rechten, semantiek en niet gepinde media blokkeren zonder writes',async()=>{
 for(const patch of [{sourceUrl:'https://example.invalid/study?lang=nld'},{sourceUrl:'https://www.churchofjesuschrist.org/study/ftsoy/2025/05/a?lang=nld'},{content:'[]'},{content:JSON.stringify([{type:'unknown',text:'Geen gokwerk'}])},{images:JSON.stringify([{url:'https://media.example.invalid/a.png',alt:'Afbeelding'}])},{...pub,publishedTitle:null,publishedImages:null}]){
  const row=await lesson(patch);const count=await prisma.studyLesson.count();
  assert.equal((await reviewFsyConversion(admin.actor,row.id)).ready,false);
  await assert.rejects(convertFsyLesson(admin.actor,row.id,action(row)));
  assert.deepEqual(await prisma.fsyLesson.findUnique({where:{id:row.id}}),row);assert.equal(await prisma.studyLesson.count(),count);
 }
 await prisma.contentCollection.update({where:{id:collection.id},data:{licenseName:null}});
 const row=await lesson();await assert.rejects(convertFsyLesson(admin.actor,row.id,action(row)),/RIGHTS/);
 await prisma.contentCollection.update({where:{id:collection.id},data:{licenseName:collection.licenseName}});
});
test('gelijktijdige conversie en retry leveren één mapping, twee revisies en één writer',async()=>{
 const row=await lesson(pub), request=action(row);
 const rs=await Promise.all([convertFsyLesson(admin.actor,row.id,request),convertFsyLesson(admin.actor,row.id,request)]);
 assert.deepEqual(rs.map(r=>r.changed).sort(),[false,true]);assert.equal(rs[0].editionId,rs[1].editionId);
 assert.equal(await prisma.studyRevision.count({where:{lessonEditionId:rs[0].editionId}}),2);
 assert.equal((await convertFsyLesson(admin.actor,row.id,action(row))).changed,false);
 const other=await lesson();await assert.rejects(convertFsyLesson(admin.actor,other.id,{...request,expectedLegacyHash:fsyLegacyIdentity(other)}),/CONFLICT/);
 await assert.rejects(prisma.fsyLesson.update({where:{id:row.id},data:{studyLessonEditionId:null}}),/FSY_STUDY_WRITER_ACTIVE/);
});
test('afgebroken handover rolt alle nieuwe inhoud terug en legacywriter blijft bruikbaar',async()=>{
 const row=await lesson(pub), count=await prisma.studyLesson.count();
 await prisma.$executeRawUnsafe(`CREATE FUNCTION test_fsy_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${row.id}' AND NEW."studyLessonEditionId" IS NOT NULL THEN RAISE EXCEPTION 'TEST_HANDOVER_INTERRUPTED'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe('CREATE TRIGGER z_test_fsy_fail BEFORE UPDATE ON "FsyLesson" FOR EACH ROW EXECUTE FUNCTION test_fsy_fail()');
 try{await assert.rejects(convertFsyLesson(admin.actor,row.id,action(row)),/TEST_HANDOVER_INTERRUPTED/);}finally{await prisma.$executeRawUnsafe('DROP TRIGGER z_test_fsy_fail ON "FsyLesson"');await prisma.$executeRawUnsafe('DROP FUNCTION test_fsy_fail()');}
 assert.deepEqual(await prisma.fsyLesson.findUnique({where:{id:row.id}}),row);assert.equal(await prisma.studyLesson.count(),count);
});
test('writerrollback behoudt alle snapshots, old retry migreert niet opnieuw; reconversie is expliciet',async()=>{
 const row=await lesson(pub), request=action(row);const r=await convertFsyLesson(admin.actor,row.id,request);const e=await edition(r.editionId);
 const revisions=await prisma.studyRevision.findMany({where:{lessonEditionId:e.id}});
 assert.equal((await rollbackFsyWriter(admin.actor,row.id,e.publicationVersion)).changed,true);
 assert.deepEqual(await prisma.fsyLesson.findUnique({where:{id:row.id}}),row);
 assert.deepEqual(await prisma.studyRevision.findMany({where:{lessonEditionId:e.id}}),revisions);
 assert.equal(await getPublishedStudyLesson(admin.actor,e.lessonId,collection.id),null);
 assert.equal((await convertFsyLesson(admin.actor,row.id,request)).changed,false);
 assert.equal((await convertFsyLesson(admin.actor,row.id,action(row))).changed,true);
});
test('gedeelde publicatie hercontroleert bron, identiteit en tekst; nieuwe publicatie blokkeert writerrollback',async()=>{
 const row=await lesson(pub), request=action(row);const r=await convertFsyLesson(admin.actor,row.id,request);const e=await edition(r.editionId);
 const run=await prisma.contentImportRun.findUniqueOrThrow({where:{id:`fsy-${request.actionId}-draft`}});
 await prisma.$transaction(db=>requireFsyPublicationSource(db,run,e.id));
 const forged=structuredClone(run);forged.snapshot.items[0].body.sections[0].blocks[0].content[0].text='Verzonnen tekst';
 await assert.rejects(prisma.$transaction(db=>requireFsyPublicationSource(db,forged,e.id)),/INCOMPLETE/);
 await publishStudyRevision(admin.actor,{editionId:e.id,revisionId:e.draftRevisionId,importRunId:run.id,kind:'PUBLISH',expectedVersion:e.publicationVersion,actionId:randomUUID()});
 await assert.rejects(rollbackFsyWriter(admin.actor,row.id,e.publicationVersion+1),/CONFLICT/);
});
test('serverrechten, origin, geen draftlek en geen voorkeurmutaties',async()=>{
 const row=await lesson();await assert.rejects(convertFsyLesson(normal.actor,row.id,action(row)),/FORBIDDEN/);
 const path=base+`/api/admin/fsy/${row.id}/conversion`;
 assert.equal((await fetch(path)).status,401);assert.equal((await fetch(path,{headers:{cookie:normal.cookie}})).status,403);
 assert.equal((await fetch(path,{method:'POST',headers:{cookie:admin.cookie,Origin:'https://evil.invalid','Content-Type':'application/json'},body:JSON.stringify(action(row))})).status,403);
 const response=await fetch(path,{headers:{cookie:admin.cookie}});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
 const old=await personal();const r=await convertFsyLesson(admin.actor,row.id,action(row));const e=await edition(r.editionId);
 for(const who of [normal,admin])assert.equal((await fetch(base+`/fsy/${row.id}`,{headers:{cookie:who.cookie}})).status,404);
 assert.equal(await personal(),old);assert.equal(e.publishedRevisionId,null);
});

test('legacyleskeuze en bestaande cursuslink blijven onafhankelijk van de nieuwe editie',async()=>{
 const row=await lesson(pub);
 const selected=await setStudyContext(normal.actor,{workKey:'fsy',activeLessonKey:'fsy:'+row.id,expectedVersion:0,actionId:randomUUID()});
 assert.equal(selected.context.available,true);
 const original=await prisma.userStudyContext.findUnique({where:{userId_workKey:{userId:normal.user.id,workKey:'fsy'}}});
 const r=await convertFsyLesson(admin.actor,row.id,action(row));
 assert.equal((await getStudyContext(normal.actor,'fsy')).lessonHref,'/fsy/'+row.id);
 assert.deepEqual(await prisma.userStudyContext.findUnique({where:{userId_workKey:{userId:normal.user.id,workKey:'fsy'}}}),original);
 await prisma.contentCollection.update({where:{id:collection.id},data:{visibleToUsers:false}});
 assert.equal((await getStudyContext(normal.actor,'fsy')).available,false);
 assert.ok(await getPublishedStudyLesson(admin.actor,(await edition(r.editionId)).lessonId,collection.id));
 await prisma.contentCollection.update({where:{id:collection.id},data:{visibleToUsers:true}});
});
test('bestaand READY-medium blijft exact gepind; ontbrekend bestand blokkeert handover',async()=>{
 const bytes=Buffer.from(FIXTURE_IMAGE,'base64'),image=await validateStudyImage(bytes,'image/png'),store=await installStudyMedia(bytes,image);
 const sourceUrl='https://media.example.invalid/'+randomUUID()+'.png';
 await prisma.contentMedia.upsert({where:{checksum:image.checksum},update:{sourceUrl},create:{...image,volumeId:store.volumeId,sourceUrl,status:'READY',sourceMetadata:{sourceKey:sourceUrl,adapter:'fsy-fixture'},rightsMetadata:{holder:'Testbron',permission:'Testtoestemming'}}});
 const row=await lesson({content:JSON.stringify([{type:'image',url:sourceUrl,alt:'Exact bijschrift'}]),images:JSON.stringify([{url:sourceUrl,alt:'Exact bijschrift'}])});
 const r=await convertFsyLesson(admin.actor,row.id,action(row));const e=await edition(r.editionId);
 const binding=await prisma.studyRevisionMedia.findFirstOrThrow({where:{revisionId:e.draftRevisionId},include:{media:true}});
 assert.equal(binding.media.checksum,image.checksum);assert.equal(e.draftRevision.body.sections[0].blocks[0].alt,'Exact bijschrift');
 const fs=await import('node:fs/promises'),path=await import('node:path');const name=path.join(process.env.STUDY_MEDIA_DIR,image.storageKey);
 await fs.rename(name,name+'.missing');
 try {const next=await lesson({content:row.content,images:row.images});await assert.rejects(convertFsyLesson(admin.actor,next.id,action(next)),/MEDIA/);}finally{await fs.rename(name+'.missing',name);}
});
