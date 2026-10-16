import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { appendStudyRevision, getPublishedStudyLesson, findPublishedLogicalLesson, findPublishedLessonEdition, studyRevisionHash } from "../src/lib/studyContent/revisions";
import { studyRevisionFixture } from "./fixtures/study-content";
const url = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== url.href) throw new Error("Eigen geïsoleerde runner vereist");
const key = `study-identity-${randomUUID()}`;
const normal = { isAdmin: false }, admin = { isAdmin: true };
let period: string, otherPeriod: string, lesson: string, secondLesson: string, nl: string, en: string, alternative: string, edition: string, enEdition: string, altEdition: string;
before(async () => {
 await prisma.contentWork.create({data:{key,kind:"STUDY_PROGRAM"}});
 period=(await prisma.studyPeriod.create({data:{workKey:key,sourceKey:"official-period-a",label:"Synthetische periode A",metadata:{irregularCalendar:true}}})).id;
 otherPeriod=(await prisma.studyPeriod.create({data:{workKey:key,sourceKey:"official-period-b",label:"Synthetische periode B"}})).id;
 lesson=(await prisma.studyLesson.create({data:{workKey:key,periodId:period,sourceKey:"official-lesson-a",order:1}})).id;
 secondLesson=(await prisma.studyLesson.create({data:{workKey:key,periodId:period,sourceKey:"official-lesson-b",order:2,month:10,categoryKey:"test-category"}})).id;
 async function collection(language:string,family:string){const id=`${key}-${language}-${family}`;await prisma.contentCollection.create({data:{id,slug:id,name:"Synthetische studie-editie",icon:"",work:key,editionKey:family,language,publicationState:"PUBLISHED",visibleToUsers:true}});return id;}
 nl=await collection("nl","family-a");en=await collection("en","family-a");alternative=await collection("nl","family-b");
 async function makeEdition(collectionId:string){return (await prisma.studyLessonEdition.create({data:{lessonId:lesson,collectionId,workKey:key,slug:"official-lesson-a"}})).id;}
 edition=await makeEdition(nl);enEdition=await makeEdition(en);altEdition=await makeEdition(alternative);
});
after(async()=>{await prisma.$disconnect();});

test("taalonafhankelijke les, twee lessen per periode, gelijke sourceKey in andere periode en drie concrete edities",async()=>{
 const next=await prisma.studyLesson.create({data:{workKey:key,periodId:otherPeriod,sourceKey:"official-lesson-a",order:0}});assert.notEqual(next.id,lesson);
 assert.equal(await prisma.studyLesson.count({where:{periodId:period}}),2);
 assert.equal(await prisma.studyLessonEdition.count({where:{lessonId:lesson}}),3);
 await assert.rejects(prisma.studyPeriod.create({data:{workKey:key,sourceKey:"official-period-a",label:"Duplicaat"}}));
 await assert.rejects(prisma.studyLesson.create({data:{workKey:key,periodId:period,sourceKey:"official-lesson-a"}}));
 await assert.rejects(prisma.studyLessonEdition.create({data:{workKey:key,lessonId:lesson,collectionId:nl,slug:"another-slug"}}));
 assert.ok(secondLesson);
});
test("database blokkeert verkeerde periode/werk/collectie, lege keys en ongeldige kalender",async()=>{
 await assert.rejects(prisma.studyPeriod.create({data:{workKey:key,sourceKey:"",label:"invalid"}}));
 await assert.rejects(prisma.studyLesson.create({data:{workKey:"bofm",periodId:period,sourceKey:"wrong-program"}}));
 await assert.rejects(prisma.studyLesson.create({data:{workKey:key,periodId:period,sourceKey:"",month:13}}));
 await assert.rejects(prisma.studyLesson.create({data:{workKey:key,periodId:period,sourceKey:"bad-dates",startsOn:new Date("2026-10-02"),endsOnExclusive:new Date("2026-10-01")}}));
 await assert.rejects(prisma.studyLessonEdition.create({data:{workKey:key,lessonId:lesson,collectionId:"content_bom",slug:"wrong-collection"}}));
 await assert.rejects(prisma.studyLessonEdition.create({data:{workKey:"bofm",lessonId:lesson,collectionId:"content_bom",slug:"wrong-lesson"}}));
});
test("append-only service valideert eerst; alleen geautoriseerde interne writes, geen automatische publicatie",async()=>{
 await assert.rejects(appendStudyRevision(normal,edition,studyRevisionFixture()),/FORBIDDEN/);
 await assert.rejects(appendStudyRevision(admin,edition,{...studyRevisionFixture(),body:{schemaVersion:1,sections:[]}}));
 assert.equal(await prisma.studyRevision.count({where:{lessonEditionId:edition}}),0);
 const a=await appendStudyRevision(admin,edition,studyRevisionFixture());const b=await appendStudyRevision(admin,edition,{...studyRevisionFixture(),title:"Tweede synthetische revisie"});
 assert.equal(a.revisionNumber,1);assert.equal(b.revisionNumber,2);assert.equal(a.contentHash,studyRevisionHash(studyRevisionFixture()));
 assert.equal(await getPublishedStudyLesson(normal,lesson,nl),null);
 assert.equal((await prisma.studyLessonEdition.findUniqueOrThrow({where:{id:edition}})).publishedRevisionId,null);
});
test("gelijktijdige revisie-inserts krijgen verschillende oplopende nummers",async()=>{
 const revisions=await Promise.all(Array.from({length:4},()=>appendStudyRevision(admin,edition,studyRevisionFixture())));
 assert.deepEqual(revisions.map(r=>r.revisionNumber).sort(),[3,4,5,6]);
 const old=revisions[0];await assert.rejects(prisma.studyRevision.create({data:{lessonEditionId:edition,revisionNumber:old.revisionNumber,schemaVersion:1,contentHash:old.contentHash,title:old.title,body:old.body!,sourceMetadata:old.sourceMetadata!,rightsMetadata:old.rightsMetadata!}}));
});
test("alle revisievelden immutable via Prisma én directe SQL; geen cascadeverwijdering",async()=>{
 const revision=await prisma.studyRevision.findFirstOrThrow({where:{lessonEditionId:edition}});
 await assert.rejects(prisma.studyRevision.update({where:{id:revision.id},data:{title:"overschreven"}}));
 await assert.rejects(prisma.$executeRaw`UPDATE "StudyRevision" SET "body"="body" WHERE id=${revision.id}`,/STUDY_REVISION_IMMUTABLE/);
 await assert.rejects(prisma.studyRevision.delete({where:{id:revision.id}}));
 await assert.rejects(prisma.studyLessonEdition.delete({where:{id:edition}}));
 await assert.rejects(prisma.studyLesson.delete({where:{id:lesson}}));
 await assert.rejects(prisma.studyPeriod.delete({where:{id:period}}));
 await assert.rejects(prisma.contentCollection.delete({where:{id:nl}}));
 assert.deepEqual(await prisma.studyRevision.findUnique({where:{id:revision.id}}),revision);
});
test("publicatie- en conceptpointers kunnen nooit naar een andere leseditie wijzen",async()=>{
 const nlRevision=await prisma.studyRevision.findFirstOrThrow({where:{lessonEditionId:edition},orderBy:{revisionNumber:"asc"}});
 const enRevision=await appendStudyRevision(admin,enEdition,studyRevisionFixture());
 for(const field of ["publishedRevisionId","draftRevisionId"]){await assert.rejects(prisma.studyLessonEdition.update({where:{id:edition},data:{[field]:enRevision.id}}));}
 await prisma.studyLessonEdition.update({where:{id:edition},data:{publishedRevisionId:nlRevision.id,draftRevisionId:nlRevision.id}});
 await prisma.studyLessonEdition.update({where:{id:enEdition},data:{publishedRevisionId:enRevision.id}});
 assert.equal((await getPublishedStudyLesson(normal,lesson,nl))?.revisionId,nlRevision.id);
 assert.equal((await getPublishedStudyLesson(normal,lesson,en))?.language,"en");
 assert.equal(await getPublishedStudyLesson(normal,lesson,alternative),null);
});
test("readonly DTO gate geldt ook voor metadata; geen bron/rechtenmetadata, fallback of gebruikerswrites",async()=>{
 const old=await prisma.userStudyContext.findMany({orderBy:[{userId:"asc"},{workKey:"asc"}]});const users=await prisma.user.findMany({orderBy:{id:"asc"}});
 const dto=await getPublishedStudyLesson(normal,lesson,nl);assert.ok(dto);assert.ok(Object.isFrozen(dto));assert.ok(Object.isFrozen(dto.body.sections[0].blocks));
 assert.equal('sourceMetadata' in dto,false);assert.equal('rightsMetadata' in dto,false);
 assert.equal((await findPublishedLogicalLesson(normal,lesson,nl))?.id,lesson);assert.equal((await findPublishedLessonEdition(normal,lesson,en))?.id,enEdition);
 assert.equal(await getPublishedStudyLesson(null,lesson,nl),null);assert.equal(await getPublishedStudyLesson(admin,lesson,"missing"),null);
 assert.deepEqual(await prisma.user.findMany({orderBy:{id:"asc"}}),users);assert.deepEqual(await prisma.userStudyContext.findMany({orderBy:[{userId:"asc"},{workKey:"asc"}]}),old);
});
test("DRAFT, verborgen en uitgeschakeld worden geweigerd, ook bij normale admin-login",async()=>{
 for(const patch of [{publicationState:"DRAFT" as const},{visibleToUsers:false},{enabled:false}]){
  await prisma.contentCollection.update({where:{id:nl},data:patch});
  for(const actor of [normal,admin]){if("visibleToUsers" in patch && actor===admin){assert.ok(await getPublishedStudyLesson(actor,lesson,nl));continue;}assert.equal(await getPublishedStudyLesson(actor,lesson,nl),null);assert.equal(await findPublishedLogicalLesson(actor,lesson,nl),null);assert.equal(await findPublishedLessonEdition(actor,lesson,nl),null);}
  await prisma.contentCollection.update({where:{id:nl},data:{publicationState:"PUBLISHED",visibleToUsers:true,enabled:true}});
 }
 await prisma.contentCollection.update({where:{id:nl},data:{publicationState:"LEGACY"}});assert.ok(await getPublishedStudyLesson(normal,lesson,nl));
 await prisma.contentCollection.update({where:{id:nl},data:{publicationState:"PUBLISHED"}});
});
test("retired les is niet publiek en krijgt geen nieuwe revisie; geschiedenis blijft",async()=>{
 const count=await prisma.studyRevision.count({where:{lessonEditionId:edition}});
 await prisma.studyLesson.update({where:{id:lesson},data:{retiredAt:new Date()}});
 assert.equal(await getPublishedStudyLesson(normal,lesson,nl),null);await assert.rejects(appendStudyRevision(admin,edition,studyRevisionFixture()),/INVALID/);
 assert.equal(await prisma.studyRevision.count({where:{lessonEditionId:edition}}),count);
 await prisma.studyLesson.update({where:{id:lesson},data:{retiredAt:null}});
});
test("corrupte directe insert/hash mismatch wordt nooit als gepubliceerde body uitgegeven",async()=>{
 const input=studyRevisionFixture();const bad=await prisma.studyRevision.create({data:{lessonEditionId:altEdition,revisionNumber:1,...input,body:input.body as never,contentHash:"0".repeat(64)}});
 await prisma.studyLessonEdition.update({where:{id:altEdition},data:{publishedRevisionId:bad.id}});assert.equal(await getPublishedStudyLesson(normal,lesson,alternative),null);
 const corrupt=await prisma.studyRevision.create({data:{lessonEditionId:altEdition,revisionNumber:2,schemaVersion:1,title:"Corrupt",body:{schemaVersion:1,sections:[{id:"bad",blocks:[{type:"unknown"}]}]},sourceMetadata:{sourceKey:"fixture"},rightsMetadata:{holder:"Test",permission:"Test"},contentHash:"1".repeat(64)}});
 await prisma.studyLessonEdition.update({where:{id:altEdition},data:{publishedRevisionId:corrupt.id}});assert.equal(await getPublishedStudyLesson(admin,lesson,alternative),null);
});

test("nieuwe collectie begint DRAFT/verborgen; zelfs een aanwezige pointer verruimt de gewone toegang niet",async()=>{
 const id=`${key}-new-default`;const row=await prisma.contentCollection.create({data:{id,slug:id,name:"Nieuw synthetisch concept",icon:"",work:key,editionKey:"new-family",language:"nl"}});
 assert.equal(row.publicationState,"DRAFT");assert.equal(row.visibleToUsers,false);
 const e=await prisma.studyLessonEdition.create({data:{workKey:key,lessonId:lesson,collectionId:id,slug:"official-lesson-a"}});
 const revision=await appendStudyRevision(admin,e.id,studyRevisionFixture());await prisma.studyLessonEdition.update({where:{id:e.id},data:{publishedRevisionId:revision.id}});
 assert.equal(await getPublishedStudyLesson(normal,lesson,id),null);assert.equal(await getPublishedStudyLesson(admin,lesson,id),null);
});
test("Schrifturen/OTHER zijn geen studieprogramma; beperkte interne write en leesgate weigeren zo'n koppeling",async()=>{
 const p=await prisma.studyPeriod.create({data:{workKey:"bofm",sourceKey:key,label:"Negatieve synthetische fixture"}});
 const l=await prisma.studyLesson.create({data:{workKey:"bofm",periodId:p.id,sourceKey:key}});
 const e=await prisma.studyLessonEdition.create({data:{workKey:"bofm",lessonId:l.id,collectionId:"content_bom",slug:key}});
 await assert.rejects(appendStudyRevision(admin,e.id,studyRevisionFixture()),/INVALID/);
 assert.equal(await getPublishedStudyLesson(normal,l.id,"content_bom"),null);
 assert.equal(await prisma.studyRevision.count({where:{lessonEditionId:e.id}}),0);
});

test("JSON-opslag behoudt de hash bij expliciet undefined optionele velden",async()=>{
 const input=studyRevisionFixture();input.sourceMetadata.url=undefined;
 input.rightsMetadata.licenseUrl=undefined;
 const revision=await appendStudyRevision(admin,edition,input);
 await prisma.studyLessonEdition.update({where:{id:edition},data:{publishedRevisionId:revision.id}});
 assert.equal((await getPublishedStudyLesson(normal,lesson,nl))?.contentHash,revision.contentHash);
});
