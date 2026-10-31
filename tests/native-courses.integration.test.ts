import assert from "node:assert/strict";
import test,{before,after} from "node:test";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { issueNativeSession, nativeSessionIdentity } from "../src/lib/native/sessions";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { nativeCoursesSchema, nativeCoursePathSchema } from "../src/lib/native/coursesContract";
import { loadReadingPath } from "../src/lib/readingPathData";
import { loadChapterPath } from "../src/lib/chapterPathData";
import { seedNativeCourses } from "./fixtures/native-courses";
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),base=process.env.NATIVE_TEST_BASE_URL!;
if(db.hostname!=="127.0.0.1"||db.pathname!=="/versado_content_access_test"||db.href!==process.env.DATABASE_URL)throw Error("Alleen eigen geïsoleerde database");
let fixture:Awaited<ReturnType<typeof seedNativeCourses>>;
before(async()=>{fixture=await seedNativeCourses();});
after(async()=>{await prisma.contentCollection.update({where:{id:fixture.collection.id},data:{enabled:false}});await prisma.$disconnect();});
async function account(){const user=await fixture.account();return{user,pair:await issueNativeSession(user.id,user.sessionVersion)};}
async function call(token?:string,path="courses",method="GET",cookie?:string){return fetch(`${base}/api/v1/native/${path}`,{method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1",...(token?{Authorization:`Bearer ${token}`} :{}),...(cookie?{Cookie:cookie}:{}),...(method==="GET"?{}:{"Content-Type":"application/json"})},...(method==="GET"?{}:{body:"{}"})});}
async function snapshot(userId:string){return{user:await prisma.user.findUniqueOrThrow({where:{id:userId}}),courses:await prisma.userCourseProgress.findMany({where:{userId},orderBy:{id:"asc"}}),read:await prisma.contentProgress.findMany({where:{userId}}),lessons:await prisma.userCourseLessonProgress.findMany({where:{userId}}),days:await prisma.streakDay.findMany({where:{userId}})};}
test("same web course cards and canonical three paths; GET never syncs or changes cursors/XP/progress",async()=>{
 const {user,pair}=await account(),before=await snapshot(user.id),cookie=`${SESSION_COOKIE}=${await createSessionToken(user.id)}`;
 const response=await call(pair.accessToken);assert.equal(response.status,200,await response.clone().text());assert.equal(response.headers.get("cache-control"),"private, no-store");const value=nativeCoursesSchema.parse(await response.json());
 const web=await fetch(`${base}/api/courses`,{headers:{Cookie:cookie}});assert.equal(web.status,200);assert.deepEqual(value.courses,(await web.json()).courses);assert.match(value.courses.find(c=>c.id===fixture.steps.id)!.resumeHref,new RegExp(fixture.steps.lessons[1].id));assert.equal(JSON.stringify(value).includes(user.email),false);
 for(const course of fixture.courses){const res=await call(pair.accessToken,`courses/${course.id}/path`);assert.equal(res.status,200,await res.clone().text());const path=nativeCoursePathSchema.parse(await res.json());
  if(path.kind==="steps"){const domain=await loadReadingPath(prisma,user.id,course.id,{readOnly:true});assert.deepEqual(path.chapters,domain.chapters);assert.equal(path.todayId,fixture.steps.lessons[1].id);assert.equal(path.chapters[1].steps[1].available,false);}
  else{const domain=await loadChapterPath(prisma,user.id,course,{readOnly:true});assert.deepEqual(path.chapters,domain.chapters);assert.equal(path.sequential,course.type==="FRONT_TO_BACK");}
 }
 assert.deepEqual(await snapshot(user.id),before);
 // No legacy first-open sync when a course has not yet been materialized.
 const empty=await prisma.course.create({data:{slug:`empty-${user.id}`,name:"Leeg",type:"READING_LESSONS",contentCollectionId:fixture.collection.id}});
 assert.equal((await call(pair.accessToken,`courses/${empty.id}/path`)).status,200);assert.equal(await prisma.courseLesson.count({where:{courseId:empty.id}}),0);assert.equal(await prisma.userCourseProgress.count({where:{userId:user.id,courseId:empty.id}}),0);
});
test("auth, no cookie fallback, exact GETs, disabled/private/retired source and foreign course",async()=>{
 const {user,pair}=await account(),path=`courses/${fixture.steps.id}/path`;
 assert.equal((await call()).status,401);assert.equal((await call(undefined,path,"GET",`${SESSION_COOKIE}=${await createSessionToken(user.id)}`)).status,401);
 assert.equal((await call(pair.accessToken,path,"POST")).status,404);assert.equal((await call(pair.accessToken,`${path}?preview=1`)).status,400);
 for(const patch of [{visibleToUsers:false},{visibleToUsers:true,publicationState:"DRAFT" as const},{publicationState:"PUBLISHED" as const,enabled:false}]){await prisma.contentCollection.update({where:{id:fixture.collection.id},data:patch});assert.equal((await call(pair.accessToken,path)).status,404);const list=nativeCoursesSchema.parse(await(await call(pair.accessToken)).json());assert.equal(list.courses.some(c=>c.id===fixture.steps.id),false);}
 await prisma.contentCollection.update({where:{id:fixture.collection.id},data:{visibleToUsers:true,enabled:true,publicationState:"PUBLISHED"}});
 const other=await seedNativeCourses("en");try{assert.equal((await call(pair.accessToken,`courses/${other.steps.id}/path`)).status,404);}finally{await prisma.contentCollection.update({where:{id:other.collection.id},data:{enabled:false}});}
 await prisma.course.update({where:{id:fixture.steps.id},data:{enabled:false}});assert.equal((await call(pair.accessToken,path)).status,404);await prisma.course.update({where:{id:fixture.steps.id},data:{enabled:true}});
});
async function delayed(change:(userId:string,sessionId:string)=>Promise<unknown>){
 const {user,pair}=await account(),identity=await nativeSessionIdentity(pair.accessToken),lock=new pg.Client({connectionString:db.href});await lock.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE "Course" IN ACCESS EXCLUSIVE MODE');let pending:Promise<Response>|undefined;
 try{pending=call(pair.accessToken);let waiting=false;for(let i=0;i<100;i++){const row=await lock.query("SELECT 1 FROM pg_locks WHERE NOT granted AND relation='\"Course\"'::regclass AND pid<>pg_backend_pid() LIMIT 1");if(row.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}assert.ok(waiting,"echte SQL-lockwachttijd vereist");await change(user.id,identity.binding.sessionId);await lock.query('COMMIT');return await pending;}finally{await lock.query('ROLLBACK');await lock.end();if(pending)await pending.catch(()=>{});}
}
test("revocation, source and timezone changes while SQL is blocked reject the complete old response",async()=>{
 assert.equal((await delayed((_,id)=>prisma.nativeSession.update({where:{id},data:{revokedAt:new Date()}}))).status,401);
 assert.equal((await delayed(userId=>prisma.user.update({where:{id:userId},data:{activeContentCollectionId:null}}))).status,409);
 assert.equal((await delayed(userId=>prisma.user.update({where:{id:userId},data:{timeZone:"America/New_York"}}))).status,409);
});
