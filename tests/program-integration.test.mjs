import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {referenceAccount,assertReferenceTestEnvironment} from './fixtures/reference-content.mjs';
import {studyRevisionFixture} from './fixtures/study-content.ts';
import {appendStudyRevision} from '../src/lib/studyContent/revisions.ts';
import {getStudyCatalogue} from '../src/lib/studyContent/catalogue.ts';
import {getStudyContext,setStudyContext} from '../src/lib/studyContext.ts';
assertReferenceTestEnvironment();
let a,b,admin,workA,workB,ca,cb,english,la,lb,second;
const choose=(workKey,id,version=0)=>({workKey,activeLessonKey:`study:${id}`,expectedVersion:version,actionId:randomUUID()});
before(async()=>{
 a=await referenceAccount();b=await referenceAccount();admin=await referenceAccount(true);
 workA='program-a-'+randomUUID();workB='program-b-'+randomUUID();
 for(const key of [workA,workB])await prisma.contentWork.create({data:{key,kind:'STUDY_PROGRAM'}});
 async function collection(work,language){const id='program-'+randomUUID();return prisma.contentCollection.create({data:{id,slug:id,name:work,work,language,editionKey:work,icon:'',publicationState:'PUBLISHED',visibleToUsers:true}});}
 ca=await collection(workA,'nl');cb=await collection(workB,'nl');english=await collection(workA,'en');
 async function lesson(work,collection,source,order,startsOn){const period=await prisma.studyPeriod.upsert({where:{workKey_sourceKey:{workKey:work,sourceKey:'official-2026'}},create:{workKey:work,sourceKey:'official-2026',label:'2026',year:2026},update:{}});const l=await prisma.studyLesson.create({data:{workKey:work,periodId:period.id,sourceKey:source,order,startsOn,endsOnExclusive:startsOn?new Date(startsOn.getTime()+7*86400000):null}});const e=await prisma.studyLessonEdition.create({data:{lessonId:l.id,collectionId:collection.id,workKey:work,slug:source}});const r=await appendStudyRevision(admin.actor,e.id,studyRevisionFixture());await prisma.studyLessonEdition.update({where:{id:e.id},data:{publishedRevisionId:r.id}});return l;}
 la=await lesson(workA,ca,'first',1,new Date('2026-01-05Z'));second=await lesson(workA,ca,'second',2,new Date('2026-01-12Z'));lb=await lesson(workB,cb,'first',1,null);
 await prisma.user.update({where:{id:a.user.id},data:{activeContentCollectionId:ca.id,contentLanguage:'nl'}});
});
after(()=>prisma.$disconnect());
test('GET schrijft niets; actieve keuze verandert niet door de kalender',async()=>{
 assert.equal((await getStudyCatalogue(a.actor)).context.activeLessonKey,null);assert.equal(await prisma.userStudyContext.count({where:{userId:a.user.id}}),0);
 const old=await prisma.user.findUnique({where:{id:a.user.id}});await setStudyContext(a.actor,choose(workA,la.id));
 const jan=await getStudyCatalogue(a.actor,new Date('2026-01-06Z')),next=await getStudyCatalogue(a.actor,new Date('2026-01-13Z'));assert.equal(jan.collectionId,ca.id);
 assert.equal(jan.currentLessonKey,`study:${la.id}`);assert.equal(next.currentLessonKey,`study:${second.id}`);assert.equal(next.context.activeLessonKey,`study:${la.id}`);assert.equal(next.context.version,1);
 assert.deepEqual(await prisma.user.findUnique({where:{id:a.user.id}}),old);assert.equal(await prisma.contentProgress.count({where:{userId:a.user.id}}),0);
});
test('twee programma’s onafhankelijk; bron- en taalwissel behouden de logische keuze',async()=>{
 await prisma.user.update({where:{id:a.user.id},data:{activeContentCollectionId:cb.id}});await setStudyContext(a.actor,choose(workB,lb.id));
 assert.equal((await getStudyContext(a.actor,workA)).activeLessonKey,`study:${la.id}`);
 await prisma.user.update({where:{id:a.user.id},data:{activeContentCollectionId:english.id,contentLanguage:'en'}});
 const unavailable=await getStudyContext(a.actor,workA);assert.equal(unavailable.available,false);assert.equal(unavailable.activeLessonKey,`study:${la.id}`);
 await assert.rejects(setStudyContext(a.actor,choose(workA,second.id,1)),/UNAVAILABLE/);
 await prisma.user.update({where:{id:a.user.id},data:{activeContentCollectionId:ca.id,contentLanguage:'nl'}});
 assert.equal((await getStudyContext(a.actor,workA)).available,true);assert.equal((await getStudyContext(a.actor,workB)).activeLessonKey,`study:${lb.id}`);
 assert.equal((await getStudyContext(b.actor,workA)).activeLessonKey,null);
});
test('bestaande vertaalde editie gebruikt exact dezelfde logische les zonder contextreset',async()=>{
 const e=await prisma.studyLessonEdition.create({data:{lessonId:la.id,collectionId:english.id,workKey:workA,slug:'translated-first'}});
 const r=await appendStudyRevision(admin.actor,e.id,studyRevisionFixture());await prisma.studyLessonEdition.update({where:{id:e.id},data:{publishedRevisionId:r.id}});
 await prisma.user.update({where:{id:a.user.id},data:{activeContentCollectionId:english.id,contentLanguage:'en'}});
 const context=await getStudyContext(a.actor,workA);assert.equal((await getStudyCatalogue(a.actor)).collectionId,english.id);assert.equal(context.version,1);assert.equal(context.lessonHref,`/study-lesson/${la.id}/${english.id}`);
 await prisma.user.update({where:{id:a.user.id},data:{activeContentCollectionId:ca.id,contentLanguage:'nl'}});
});
test('gelijktijdige keuzes en retry; geen stale overschrijving',async()=>{
 const first=choose(workA,second.id,1),other={...choose(workA,la.id,1),activeLessonKey:null};
 const rs=await Promise.allSettled([setStudyContext(a.actor,first),setStudyContext(a.actor,other)]);assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);
 const context=await getStudyContext(a.actor,workA);assert.equal(context.version,2);await assert.rejects(setStudyContext(a.actor,choose(workA,la.id,1)),/CONFLICT/);
 const winner=rs[0].status==='fulfilled'?first:other;assert.equal((await setStudyContext(a.actor,winner)).changed,false);
});
test('ingetrokken collectie en draft blijven buiten lijst en selectie; context blijft opgeslagen',async()=>{
 for(const patch of [{visibleToUsers:false},{enabled:false},{publicationState:'DRAFT'}]){
  await prisma.contentCollection.update({where:{id:ca.id},data:patch});const data=await getStudyCatalogue(a.actor);assert.equal(data.lessons.length,0);
  assert.equal((await getStudyContext(a.actor,workA)).available,false);
  await assert.rejects(setStudyContext(a.actor,choose(workA,second.id,2)),/UNAVAILABLE/);
  await prisma.contentCollection.update({where:{id:ca.id},data:{visibleToUsers:true,enabled:true,publicationState:'PUBLISHED'}});
 }
});
