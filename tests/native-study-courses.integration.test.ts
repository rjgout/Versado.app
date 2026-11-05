import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/db";
import { issueNativeSession,nativeSessionIdentity } from "../src/lib/native/sessions";
import { nativeStudyCourseSchema,nativeStudyStepsSchema } from "../src/lib/native/studyCoursesContract";
import { getStepProgress } from "../src/lib/studyContent/stepProgress";
import { getPublishedStudyLesson,appendStudyRevision,type StudyRevisionInput } from "../src/lib/studyContent/revisions";
import { personalStudyFor,legacyPersonalPlan } from "../src/lib/studyContent/personalStudyOverrides";
import { seedNativeCfm } from "./fixtures/native-cfm";
import pg from "pg";
import { setStudyContext } from "../src/lib/studyContext";
import { userDayKey } from "../src/lib/timeZone";
import { randomUUID } from "node:crypto";
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),base=process.env.NATIVE_TEST_BASE_URL;
if(db.hostname!=="127.0.0.1"||db.pathname!=="/versado_content_access_test"||db.href!==process.env.DATABASE_URL)throw Error("Eigen runner vereist");
let fx:Awaited<ReturnType<typeof seedNativeCfm>>;
before(async()=>{fx=await seedNativeCfm();});after(async()=>{await fx.cleanup();await prisma.$disconnect();});
async function call(token:string,path:string,method="GET"){return fetch(`${base}/api/v1/native/${path}`,{method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1",Authorization:`Bearer ${token}`}});}
async function snapshot(id:string){return {user:await prisma.user.findUnique({where:{id}}),steps:await prisma.studyStepProgress.findMany({where:{userId:id},orderBy:{stepFingerprint:"asc"}}),contexts:await prisma.userStudyContext.findMany({where:{userId:id}}),read:await prisma.contentProgress.findMany({where:{userId:id}}),positions:await prisma.readingPosition.findMany({where:{userId:id}}),courses:await prisma.userCourseProgress.findMany({where:{userId:id},orderBy:{id:"asc"}}),streak:await prisma.streakDay.findMany({where:{userId:id}})};}
test("legacyprojectie onder READ ONLY is gelijk aan bestaande materialisatie; bestaande rijen winnen",async()=>{
 const user=await fx.account(),edition=fx.editions[0],lesson=(await getPublishedStudyLesson(user,edition.lessonId,edition.collectionId))!,plan=personalStudyFor(lesson),legacy=legacyPersonalPlan(lesson);
 assert.ok(plan.supported&&legacy.supported);if(!plan.supported||!legacy.supported)throw Error("Zes echte fixturestappen vereist");
 const at=new Date("2026-01-01T10:00:00Z");
 for(const step of legacy.steps)await prisma.studyStepProgress.create({data:{userId:user.id,lessonEditionId:edition.id,revisionId:edition.revisionId,stepIndex:step.index,stepFingerprint:step.fingerprint,planVersion:1,status:"COMPLETED",openedAt:at,completedAt:at}});
 await prisma.studyStepProgress.create({data:{userId:user.id,lessonEditionId:edition.id,revisionId:edition.revisionId,stepIndex:plan.steps[0].index,stepFingerprint:plan.steps[0].fingerprint,planVersion:plan.version,status:"IN_PROGRESS",openedAt:at}});
 const before=await snapshot(user.id);
 const projected=await prisma.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');return getStepProgress(user,lesson,plan,tx,{readOnly:true});});
 assert.equal(projected?.steps.length,6);assert.equal(projected?.steps[0].status,"IN_PROGRESS");assert.ok(projected!.completedCount>0);
 assert.deepEqual(await snapshot(user.id),before);
 const pair=await issueNativeSession(user.id,user.sessionVersion);
 const route=`courses/${fx.steps.id}/weeks`,result=nativeStudyCourseSchema.parse(await(await call(pair.accessToken,route)).json());
 const detail=nativeStudyStepsSchema.parse(await(await call(pair.accessToken,`${route}/${edition.id}/steps`)).json());
 assert.deepEqual(detail.state,projected);assert.equal(result.weeks.find(w=>w.id===edition.id)?.stepsDone,projected?.completedCount);
 assert.deepEqual(await snapshot(user.id),before);
 const materialized=await getStepProgress(user,lesson,plan);assert.deepEqual(materialized,projected);
 const count=await prisma.studyStepProgress.count({where:{userId:user.id}});await getStepProgress(user,lesson,plan);assert.equal(await prisma.studyStepProgress.count({where:{userId:user.id}}),count);
});
test("cursusmethoden, kalender, archief, zes stappen; herhaalde GETs schrijven geen voortgang",async()=>{
 const user=await fx.account(),pair=await issueNativeSession(user.id,user.sessionVersion),before=await snapshot(user.id);
 for(const course of fx.courses)for(const scope of ["weeks","archive"]){const res=await call(pair.accessToken,`courses/${course.id}/${scope}`);assert.equal(res.status,200,await res.clone().text());const data=nativeStudyCourseSchema.parse(await res.json());assert.equal(data.courseId,course.id);assert.equal(data.scope,scope);assert.equal(data.truncated,false);if(scope==="weeks"){assert.equal(data.activeWeekId,fx.editions[0].id);assert.equal(data.resumeReason,"calendar");}else{assert.equal(data.groups[0].year,2026);assert.ok(data.groups[0].weeks.some(w=>w.id===fx.editions[2].id));}}
 for(let i=0;i<2;i++){const res=await call(pair.accessToken,`courses/${fx.steps.id}/weeks/${fx.editions[0].id}/steps`);assert.equal(res.status,200);assert.equal(nativeStudyStepsSchema.parse(await res.json()).steps.length,6);}
 assert.deepEqual(await snapshot(user.id),before);
 assert.equal((await call(pair.accessToken,`courses/${fx.steps.id}/weeks?preview=1`)).status,400);
 assert.notEqual((await call(pair.accessToken,`courses/${fx.steps.id}/weeks`,"POST")).status,200);
});
test("geen kalenderweek: gekozen is niet bestudeerd; echte recente activiteit en tijdzones blijven leidend",async()=>{
 const user=await fx.account(),pair=await issueNativeSession(user.id,user.sessionVersion),edition=fx.editions[0],original=await prisma.studyLesson.findUniqueOrThrow({where:{id:edition.lessonId}});
 try {
  const starts=new Date(original.startsOn!.getTime()-21*86400000),ends=new Date(original.endsOnExclusive!.getTime()-21*86400000);
  await prisma.studyLesson.update({where:{id:edition.lessonId},data:{startsOn:starts,endsOnExclusive:ends}});
  const load=async()=>nativeStudyCourseSchema.parse(await(await call(pair.accessToken,`courses/${fx.steps.id}/weeks`)).json());
  assert.equal((await load()).resumeReason,null);
  const chosen=await setStudyContext(user,{workKey:edition.workKey,activeLessonKey:`study:${edition.lessonId}`,expectedVersion:0,actionId:randomUUID()});
  const selected=await load();assert.equal(selected.resumeReason,"selected");assert.equal(selected.activeWeekId,edition.id);assert.equal(selected.weeks.find(w=>w.id===edition.id)?.lastStudiedAt,null);
  await setStudyContext(user,{workKey:edition.workKey,activeLessonKey:null,expectedVersion:chosen.context.version,actionId:randomUUID()});
  const other=fx.editions[1],lesson=(await getPublishedStudyLesson(user,other.lessonId,other.collectionId))!,plan=personalStudyFor(lesson);assert.ok(plan.supported);if(!plan.supported)throw Error("fixtureplan");
  await prisma.studyStepProgress.create({data:{userId:user.id,lessonEditionId:other.id,revisionId:other.revisionId,planVersion:plan.version,stepIndex:1,stepFingerprint:plan.steps[0].fingerprint,status:"IN_PROGRESS"}});
  const studied=await load();assert.equal(studied.resumeReason,"studied");assert.equal(studied.activeWeekId,other.id);
  for(const timeZone of ["Pacific/Kiritimati","America/Adak"]){const current=await prisma.user.update({where:{id:user.id},data:{timeZone}});const data=await load();assert.equal(data.today,userDayKey(current,new Date()));assert.equal(data.timeZone,timeZone);}
 }finally{await prisma.studyLesson.update({where:{id:edition.lessonId},data:{startsOn:original.startsOn,endsOnExclusive:original.endsOnExclusive}});}
});
test("rechten en publicatie-intrekking blijven leidend; geen vreemd programma of verplichte setup",async()=>{
 const user=await fx.account(),pair=await issueNativeSession(user.id,user.sessionVersion),edition=fx.editions[0],path=`courses/${fx.steps.id}/weeks/${edition.id}/steps`;
 assert.equal((await call(pair.accessToken,`courses/${fx.steps.id}/path`)).status,404,"oud schriftelijk contract blijft ongewijzigd");
 assert.equal((await call(pair.accessToken,`courses/${fx.steps.id}/weeks/${fx.foreignEditionId}/steps`)).status,404);
 await prisma.course.update({where:{id:fx.steps.id},data:{enabled:false}});assert.equal((await call(pair.accessToken,`courses/${fx.steps.id}/weeks`)).status,404);await prisma.course.update({where:{id:fx.steps.id},data:{enabled:true}});
 await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:null}});assert.equal((await call(pair.accessToken,path)).status,404);await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:edition.revisionId}});
 await prisma.user.update({where:{id:user.id},data:{mustChangePassword:true}});assert.equal((await call(pair.accessToken,path)).status,401);await prisma.user.update({where:{id:user.id},data:{mustChangePassword:false,isAdmin:true,totpEnabled:false}});assert.equal((await call(pair.accessToken,path)).status,401);
});
async function blocked(change:(id:string,sid:string)=>Promise<unknown>){
 const user=await fx.account(),pair=await issueNativeSession(user.id,user.sessionVersion),identity=await nativeSessionIdentity(pair.accessToken),lock=new pg.Client({connectionString:db.href});await lock.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE "StudyStepProgress" IN ACCESS EXCLUSIVE MODE');let pending:Promise<Response>|undefined;
 try{pending=call(pair.accessToken,`courses/${fx.steps.id}/weeks/${fx.editions[0].id}/steps`);let waiting=false;for(let i=0;i<120;i++){if((await lock.query('SELECT 1 FROM pg_locks WHERE NOT granted AND relation=\'"StudyStepProgress"\'::regclass')).rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}assert.ok(waiting);await change(user.id,identity.binding.sessionId);await lock.query('COMMIT');return await pending;}finally{await lock.query('ROLLBACK');await lock.end();if(pending)await pending.catch(()=>{});}
}
test("daadwerkelijke lockwacht: logout, verloop, bronwisseling en publicatie-intrekking verwerpen oud antwoord",async()=>{
 assert.equal((await blocked((_,sid)=>prisma.nativeSession.update({where:{id:sid},data:{revokedAt:new Date()}}))).status,401);
 assert.equal((await blocked(async(_,sid)=>{await prisma.nativeSession.update({where:{id:sid},data:{expiresAt:new Date(Date.now()+100)}});await new Promise(r=>setTimeout(r,150));})).status,401);
 assert.equal((await blocked(id=>prisma.user.update({where:{id},data:{activeContentCollectionId:null}}))).status,409);
 try{assert.equal((await blocked(()=>prisma.course.update({where:{id:fx.steps.id},data:{enabled:false}}))).status,404);}finally{await prisma.course.update({where:{id:fx.steps.id},data:{enabled:true}});}
 const original=await prisma.studyRevision.findUniqueOrThrow({where:{id:fx.editions[0].revisionId}}),admin=await prisma.user.findFirstOrThrow({where:{isAdmin:true}});
 const changed=await appendStudyRevision(admin,fx.editions[0].id,{schemaVersion:1,title:"Gewijzigde synthetische revisie",body:original.body as unknown as StudyRevisionInput["body"],sourceMetadata:original.sourceMetadata as unknown as StudyRevisionInput["sourceMetadata"],rightsMetadata:original.rightsMetadata as unknown as StudyRevisionInput["rightsMetadata"]});
 try{assert.equal((await blocked(()=>prisma.studyLessonEdition.update({where:{id:fx.editions[0].id},data:{publishedRevisionId:changed.id}}))).status,409);}finally{await prisma.studyLessonEdition.update({where:{id:fx.editions[0].id},data:{publishedRevisionId:original.id}});}
 const edition=fx.editions[0];try{assert.equal((await blocked(()=>prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:null}}))).status,409);}finally{await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:edition.revisionId}});}
});
