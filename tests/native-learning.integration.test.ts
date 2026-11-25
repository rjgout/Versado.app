import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { seedNativeCourses } from "./fixtures/native-courses";
import { issueNativeSession, nativeSessionIdentity } from "../src/lib/native/sessions";
import { issueExerciseSession, submitExerciseSession, contentKeyOf, clearExercisePlanCache } from "../src/lib/learning/contentProgress";
import { completeReadingLesson } from "../src/lib/readingLessons";
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),base=process.env.NATIVE_TEST_BASE_URL!;
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||database.href!==process.env.DATABASE_URL)throw Error("Uitsluitend geïsoleerde database");
const fixtureCollections:string[]=[];
after(async()=>{await prisma.contentCollection.updateMany({where:{id:{in:fixtureCollections}},data:{enabled:false}});await prisma.$disconnect();});
async function fixture(language="nl",questions=true) {
  const f=await seedNativeCourses(language);
  fixtureCollections.push(f.collection.id);
  if(questions)for(const verse of await prisma.verse.findMany({where:{chapterId:f.chapters[1].id}}))await prisma.exercise.create({data:{chapterId:verse.chapterId,order:verse.number,type:"TRUE_FALSE",sourceVerseId:verse.id,verseRef:`Alma 32:${verse.number}`,prompt:`Synthetische vraag ${verse.number}`,answers:'["true"]'}});
  clearExercisePlanCache();
  const user=await f.account(language),pair=await issueNativeSession(user.id,user.sessionVersion);
  return {...f,user,pair};
}
type F=Awaited<ReturnType<typeof fixture>>;
function route(f:F,kind="steps",course=f.steps.id,target=f.steps.lessons[1].id) {return `courses/${course}/read/${kind}/${target}/learning`;}
function scope(f:F,start=1,end=2) {return {activeCollectionId:f.collection.id,selectionVersion:0,language:f.user.uiLanguage,chapterId:f.chapters[1].id,startVerse:start,endVerse:end};}
async function call(f:F,path:string,body?:unknown,token=f.pair.accessToken) {
  return fetch(`${base}/api/v1/native/${path}`,{method:body===undefined?"GET":"POST",headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1",Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function ok(response:Response){assert.equal(response.status,200,await response.clone().text());return response.json();}
async function start(f:F,path=route(f),input=scope(f),actionId=randomUUID()) {return ok(await call(f,path+"/start",{...input,actionId}));}
const answers=(set:{exercises:Array<{id:string}>},given="true")=>set.exercises.map(e=>({exerciseId:e.id,given:[given]}));
async function snapshot(userId:string) {
  return {
    user:await prisma.user.findUnique({where:{id:userId}}),
    content:await prisma.contentProgress.findMany({where:{userId},orderBy:{id:"asc"}}),
    credits:await prisma.contentExerciseCredit.findMany({where:{userId},orderBy:{id:"asc"}}),
    xp:await prisma.xPTransaction.findMany({where:{userId},orderBy:{id:"asc"}}),
    steps:await prisma.userCourseLessonProgress.findMany({where:{userId},orderBy:{id:"asc"}}),
    courses:await prisma.userCourseProgress.findMany({where:{userId},orderBy:{id:"asc"}}),
    activities:await prisma.streakActivity.findMany({where:{userId},orderBy:{id:"asc"}}),
    days:await prisma.streakDay.findMany({where:{userId},orderBy:{id:"asc"}}),
    sessions:await prisma.exerciseSession.findMany({where:{userId},orderBy:{id:"asc"}}),
    attempts:await prisma.exerciseAttempt.findMany({where:{userId},orderBy:{id:"asc"}}),
  };
}
test("vijf talen: native en web delen exacte stapvragen; oude grenzen lekken geen vraag van vers 4",async()=>{
  for(const language of ["nl","en","de","fr","es"]) {
    const f=await fixture(language),set=await start(f);
    const web=await issueExerciseSession(f.user.id,f.chapters[1].id,{lessonId:f.steps.lessons[1].id,startVerse:1,endVerse:2});
    assert.deepEqual(set.exercises.map((e:{id:string})=>e.id).sort(),web.exercises.map(e=>e.id).sort());
    assert.equal(set.exercises.length,2);
    assert.equal(JSON.stringify(set).includes("correctAnswer"),false);
    assert.equal(JSON.stringify(set).includes('"answers"'),false);
    for(const e of set.exercises)assert.ok(e.verseRef.endsWith(":1")||e.verseRef.endsWith(":2"));
    const response=await ok(await call(f,route(f)+"/submit",{...scope(f),sessionId:set.sessionId,answers:answers(set)}));
    assert.equal(response.outcome.nextLessonId,f.steps.lessons[2].id);
    assert.equal(response.outcome.content.read,"READING");
    assert.equal(response.outcome.content.done,false);
  }
});
test("drie leesmethoden: hoofdstukvragen, expliciet lezen zonder XP en identieke webbeloningen",async()=>{
  for(const type of ["READING_LESSONS","FRONT_TO_BACK","FREE_CHOICE"]) {
    const f=await fixture(),webUser=await f.account();
    const course=f.courses.find(c=>c.type===type)!,kind=type==="READING_LESSONS"?"steps":"chapters",target=kind==="steps"?f.steps.lessons[1].id:f.chapters[1].id;
    const p=route(f,kind,course.id,target),input=scope(f,1,kind==="steps"?2:4);
    const set=await start(f,p,input);
    const webSet=await issueExerciseSession(webUser.id,f.chapters[1].id,kind==="steps"?{lessonId:target,startVerse:1,endVerse:2}:undefined);
    const result=await ok(await call(f,p+"/submit",{...input,sessionId:set.sessionId,answers:answers(set,"false")}));
    const web=kind==="steps"?await completeReadingLesson(webUser.id,target,webSet.sessionId!,answers({exercises:webSet.exercises},"false")):await submitExerciseSession(webUser.id,webSet.sessionId!,answers({exercises:webSet.exercises},"false"));
    for(const key of ["xpEarned","baseXp","bonusXp","repeatXp","scorePercent","correctCount","total"] as const)assert.equal(result.outcome[key],web[key]);
    if(kind==="chapters") {
      const xp=(await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).xpTotal;
      const read=await ok(await call(f,p+"/read",{...input,actionId:randomUUID()}));
      assert.equal(read.outcome.content.read,"READ");
      assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).xpTotal,xp);
    }
  }
});
test("identieke dubbele en gelijktijdige inzending: oorspronkelijke uitkomst, één commit en afwijkende replay geweigerd",async()=>{
  const f=await fixture(),set=await start(f),input={...scope(f),sessionId:set.sessionId,answers:answers(set)};
  const responses=await Promise.all([call(f,route(f)+"/submit",input),call(f,route(f)+"/submit",input)]);
  const [a,b]=await Promise.all(responses.map(ok));
  assert.deepEqual(a.outcome,b.outcome);assert.notEqual(a.replayed,b.replayed);
  const state=await snapshot(f.user.id);
  const replay=await ok(await call(f,route(f)+"/submit",input));
  assert.equal(replay.replayed,true);assert.deepEqual(replay.outcome,a.outcome);
  const status=await ok(await call(f,route(f)+"/sessions/"+set.sessionId));
  assert.deepEqual(status.outcome,a.outcome);
  assert.deepEqual(await snapshot(f.user.id),state);
  assert.equal((await call(f,route(f)+"/submit",{...input,answers:answers(set,"false")})).status,409);
  assert.deepEqual(await snapshot(f.user.id),state);
});
test("startretry hervat dezelfde set en GET verandert geen enkele databasetabel",async()=>{
  const f=await fixture(),actionId=randomUUID(),first=await start(f,route(f),scope(f),actionId);
  assert.deepEqual(await start(f,route(f),scope(f),actionId),first);
  const db=new pg.Client({connectionString:database.href});await db.connect();
  try {
    const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    async function all() {const result:Record<string,string>={};for(const {tablename} of tables) {const table='"'+tablename.replaceAll('"','""')+'"';result[tablename]=(await db.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) digest FROM ${table} t`)).rows[0].digest;}return result;}
    const before=await all();
    for(let i=0;i<2;i++){await ok(await call(f,route(f)+"/sessions/"+first.sessionId));await ok(await call(f,route(f).replace(/\/learning$/,"") ));}
    assert.deepEqual(await all(),before);
  } finally {await db.end();}
});
test("geen vragen: expliciete stapafronding raakt slechts die stap, geen XP; recovery zonder nieuwe cursusmutatie",async()=>{
  const f=await fixture("nl",false),set=await start(f);assert.deepEqual(set.exercises,[]);
  const actionId=randomUUID(),input={...scope(f),actionId};
  const first=await ok(await call(f,route(f)+"/read",input));
  assert.equal(first.outcome.nextLessonId,f.steps.lessons[2].id);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).xpTotal,0);
  assert.equal(await prisma.userCourseLessonProgress.count({where:{userId:f.user.id,completed:true}}),1);
  const state=await snapshot(f.user.id);
  assert.deepEqual((await ok(await call(f,route(f)+"/read",input))).outcome,first.outcome);
  assert.deepEqual(await snapshot(f.user.id),state);
  assert.equal((await prisma.contentProgress.findUniqueOrThrow({where:{userId_contentKey:{userId:f.user.id,contentKey:contentKeyOf({id:f.chapters[1].id,number:32,book:{key:"bofm/alma"}})}}})).readStatus,"READING");
});
test("stap met vragen mag niet via lezen worden afgerond; losse controle blijft eigen set en schrijft niets",async()=>{
  const f=await fixture(),set=await start(f),before=await snapshot(f.user.id);
  assert.equal((await call(f,route(f)+"/read",{...scope(f),actionId:randomUUID()})).status,409);
  const checked=await ok(await call(f,route(f)+"/check",{...scope(f),sessionId:set.sessionId,exerciseId:set.exercises[0].id,given:["false"]}));
  assert.equal(checked.correct,false);assert.deepEqual(checked.correctAnswer,["true"]);
  assert.equal((await call(f,route(f)+"/check",{...scope(f),sessionId:set.sessionId,exerciseId:"foreign",given:["true"]})).status,404);
  assert.deepEqual(await snapshot(f.user.id),before);
});
test("verlopen poging, ander account, andere native sessie, bron-ABA en ingetrokken cursus worden afgewezen",async()=>{
  for(const change of ["age","account","session","source","course","logout","2fa"]) {
    const f=await fixture(),set=await start(f);let token=f.pair.accessToken;
    if(change==="age") {
      const old=await prisma.exerciseSession.findUniqueOrThrow({where:{id:set.sessionId}});
      const expired=await prisma.exerciseSession.create({data:{id:randomUUID(),userId:old.userId,chapterId:old.chapterId,courseLessonId:old.courseLessonId,contentKey:old.contentKey,exerciseIds:old.exerciseIds,nativeContext:JSON.parse(JSON.stringify(old.nativeContext)),createdAt:new Date(Date.now()-8*86400_000)}});
      set.sessionId=expired.id;
    }
    if(change==="account"){const b=await f.account();token=(await issueNativeSession(b.id,b.sessionVersion)).accessToken;}
    if(change==="session")token=(await issueNativeSession(f.user.id,f.user.sessionVersion)).accessToken;
    if(change==="source") { await prisma.user.update({where:{id:f.user.id},data:{activeContentCollectionId:null}}); await prisma.user.update({where:{id:f.user.id},data:{activeContentCollectionId:f.collection.id}}); }
    if(change==="course")await prisma.course.update({where:{id:f.steps.id},data:{enabled:false}});
    if(change==="logout"){const {binding}=await nativeSessionIdentity(token);await prisma.nativeSession.update({where:{id:binding.sessionId},data:{revokedAt:new Date()}});}
    if(change==="2fa")await prisma.user.update({where:{id:f.user.id},data:{mustChangePassword:true}});
    const before=await snapshot(f.user.id),response=await call(f,route(f)+"/submit",{...scope(f),sessionId:set.sessionId,answers:answers(set)},token);
    assert.ok([401,403,404,409].includes(response.status),change+":"+await response.text());
    assert.deepEqual(await snapshot(f.user.id),before);
  }
});
test("fout na beloningsberekening rolt claim, XP, credits en cursus volledig terug",async()=>{
  const f=await fixture(),set=await start(f),before=await snapshot(f.user.id),db=new pg.Client({connectionString:database.href});await db.connect();
  try {
    await db.query(`CREATE FUNCTION b3c_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${set.sessionId}' AND NEW.result IS DISTINCT FROM OLD.result THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER b3c_fail_receipt BEFORE UPDATE ON "ExerciseSession" FOR EACH ROW EXECUTE FUNCTION b3c_fail_receipt()');
    assert.equal((await call(f,route(f)+"/submit",{...scope(f),sessionId:set.sessionId,answers:answers(set)})).status,500);
    assert.deepEqual(await snapshot(f.user.id),before);
  } finally {await db.query('DROP TRIGGER IF EXISTS b3c_fail_receipt ON "ExerciseSession"');await db.query('DROP FUNCTION IF EXISTS b3c_fail_receipt()');await db.end();}
  await ok(await call(f,route(f)+"/submit",{...scope(f),sessionId:set.sessionId,answers:answers(set)}));
});

test("twee afzonderlijke Node-processen: één beloning, identiek duurzaam resultaat",async()=>{
  const {spawn}=await import("node:child_process");
  const f=await fixture(),set=await start(f),{binding}=await nativeSessionIdentity(f.pair.accessToken);
  const input={binding,courseId:f.steps.id,kind:"steps",targetId:f.steps.lessons[1].id,input:{...scope(f),sessionId:set.sessionId,answers:answers(set)}};
  const worker=()=>new Promise<Record<string,unknown>>((resolve,reject)=>{
    const child=spawn(process.execPath,["--import","tsx","tests/fixtures/native-learning-worker.ts"],{env:process.env,stdio:["pipe","pipe","pipe"]});
    let output="",error="";child.stdout.on("data",d=>output+=d);child.stderr.on("data",d=>error+=d);
    child.on("error",reject);child.on("exit",code=>{if(code!==0)return reject(Error(error));const result=output.split("\n").find(line=>line.startsWith("RESULT:"));if(!result)return reject(Error("Geen workerresultaat"));resolve(JSON.parse(result.slice(7)));});
    child.stdin.end(JSON.stringify(input));
  });
  const [a,b]=await Promise.all([worker(),worker()]);
  assert.deepEqual(a.outcome,b.outcome);assert.notEqual(a.replayed,b.replayed);
  assert.equal(await prisma.streakActivity.count({where:{userId:f.user.id,key:`content:${set.sessionId}`}}),1);
  assert.equal(await prisma.exerciseAttempt.count({where:{userId:f.user.id}}),2);
});

async function waiting(db:pg.Client,table:string) {
  const until=Date.now()+1100;
  while(Date.now()<until) {
    await db.query("SELECT pg_stat_clear_snapshot()");
    const result=await db.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE $1",[`%${table}%`]);
    if(result.rowCount)return;
    await new Promise(r=>setTimeout(r,10));
  }
  throw Error("Geen bewezen lockwacht: "+table);
}
test("revocation, sessieverloop en tekstwijziging tijdens echte database-lockwacht blokkeren commit",async()=>{
  for(const change of ["revoked","expired","text","source","password","2fa"]) {
    const f=await fixture(),set=await start(f),db=new pg.Client({connectionString:database.href});await db.connect();
    const {binding}=await nativeSessionIdentity(f.pair.accessToken);

    const before=await snapshot(f.user.id);
    let request:Promise<Response>|undefined;
    try {
      await db.query("BEGIN");
      if(change==="text")await db.query('UPDATE "Verse" SET text=text || \' gewijzigd\' WHERE "chapterId"=$1',[f.chapters[1].id]);
      else await db.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[f.user.id]);
      request=call(f,route(f)+"/submit",{...scope(f),sessionId:set.sessionId,answers:answers(set)});
      await waiting(db,change==="text"?"Verse":"User");
      if(change==="revoked")await db.query('UPDATE "NativeSession" SET "revokedAt"=now() WHERE id=$1',[binding.sessionId]);
      if(change==="expired") { await db.query('UPDATE "NativeSession" SET "expiresAt"=clock_timestamp()+INTERVAL \'150 milliseconds\' WHERE id=$1',[binding.sessionId]); await new Promise(r=>setTimeout(r,200)); }
      if(change==="source") { await db.query('UPDATE "User" SET "activeContentCollectionId"=NULL WHERE id=$1',[f.user.id]); await db.query('UPDATE "User" SET "activeContentCollectionId"=$2 WHERE id=$1',[f.user.id,f.collection.id]); }
      if(change==="password")await db.query('UPDATE "User" SET "sessionVersion"="sessionVersion"+1 WHERE id=$1',[f.user.id]);
      if(change==="2fa")await db.query('UPDATE "User" SET "mustChangePassword"=true WHERE id=$1',[f.user.id]);
      await db.query("COMMIT");
      const response=await request;
      assert.equal(response.status,["text","source"].includes(change)?409:401,change+":"+await response.text());
      const after=await snapshot(f.user.id);
      // NativeSession/Verse zijn bewust door de onafhankelijke intrekking gewijzigd;
      // alle domeintabellen en het gebruikersrecord blijven exact gelijk.
      if(["source","password","2fa"].includes(change))assert.deepEqual({...after,user:null},{...before,user:null});
      else assert.deepEqual(after,before);
    } finally {await db.query("ROLLBACK");if(request)await request.catch(()=>{});await db.end();}
  }
});

test("correct oefenen en herhaling via andere leesmethode behouden dezelfde web-XP-korting en contentgrens",async()=>{
  const f=await fixture(),webUser=await f.account(),input=scope(f,1,4);
  for(const type of ["FREE_CHOICE","FRONT_TO_BACK"]) {
    const course=f.courses.find(c=>c.type===type)!,p=route(f,"chapters",course.id,f.chapters[1].id);
    const set=await start(f,p,input),webSet=await issueExerciseSession(webUser.id,f.chapters[1].id);
    const result=await ok(await call(f,p+"/submit",{...input,sessionId:set.sessionId,answers:answers(set)}));
    const web=await submitExerciseSession(webUser.id,webSet.sessionId!,answers({exercises:webSet.exercises}));
    for(const key of ["xpEarned","baseXp","bonusXp","repeatXp","scorePercent","correctCount","total"] as const)assert.equal(result.outcome[key],web[key],type+":"+key);
    if(type==="FRONT_TO_BACK") {assert.equal(result.outcome.baseXp,0);assert.equal(result.outcome.bonusXp,0);assert.equal(result.outcome.repeatXp,3);}
  }
});

test("additieve migratie: bestaande sessies behouden, foutrollback, result-check en immutable native identiteit",async()=>{
  const {readFileSync}=await import("node:fs"),f=await fixture(),set=await start(f);
  const original=await prisma.exerciseSession.findUniqueOrThrow({where:{id:set.sessionId}});
  const schema="b3c_migration_"+randomUUID().replaceAll("-",""),db=new pg.Client({connectionString:database.href});await db.connect();
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}, public`);
    await db.query(`CREATE TABLE "ExerciseSession" (LIKE public."ExerciseSession" INCLUDING ALL)`);
    await db.query('ALTER TABLE "ExerciseSession" DROP COLUMN "nativeContext" CASCADE');
    await db.query('INSERT INTO "ExerciseSession" (id,"userId","chapterId","contentKey","exerciseIds","createdAt") VALUES ($1,$2,$3,$4,$5,$6)',[original.id,original.userId,original.chapterId,original.contentKey,original.exerciseIds,original.createdAt]);
    const before=(await db.query('SELECT to_jsonb(t) value FROM "ExerciseSession" t')).rows;
    const sql=readFileSync("prisma/migrations/20261209120000_native_learning_context/migration.sql","utf8");
    await assert.rejects(db.query(sql.replace(/COMMIT;\s*$/,"SELECT 1/0; COMMIT;")));
    await db.query("ROLLBACK");
    assert.deepEqual((await db.query('SELECT to_jsonb(t) value FROM "ExerciseSession" t')).rows,before);
    await db.query(sql);
    assert.deepEqual((await db.query(`SELECT to_jsonb(t)-'nativeContext' value FROM "ExerciseSession" t`)).rows,before);
    assert.equal((await db.query('SELECT "nativeContext" FROM "ExerciseSession"')).rows[0].nativeContext,null);
    await assert.rejects(db.query('UPDATE "ExerciseSession" SET result=\'{}\'::jsonb'));
    await db.query('UPDATE "ExerciseSession" SET "nativeContext"=$1::jsonb',[JSON.stringify(original.nativeContext)]);
    await assert.rejects(db.query('UPDATE "ExerciseSession" SET "exerciseIds"=\'[]\''),/NATIVE_LEARNING_SESSION_IMMUTABLE/);
    await db.query('UPDATE "ExerciseSession" SET "submittedAt"=now(),result=\'{"outcome":{}}\'::jsonb');
    await assert.rejects(db.query('UPDATE "ExerciseSession" SET result=\'{"outcome":{"xpEarned":999}}\'::jsonb'),/NATIVE_LEARNING_RESULT_IMMUTABLE/);
  } finally {await db.query("ROLLBACK");await db.query("SET search_path TO public");await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.end();}
});

test("bestaande gecontroleerde cursusremap behoudt native historie maar autoriseert de oude leesstap niet opnieuw",async()=>{
  const {applyLessonPlan}=await import("../src/lib/courses");
  const f=await fixture("nl",false),target=f.steps.lessons[2].id,p=route(f,"steps",f.steps.id,target),input=scope(f,3,4);
  // Maak eerst de vorige leesstap expliciet af, zonder vragen of XP.
  await ok(await call(f,route(f)+"/read",{...scope(f),actionId:randomUUID()}));
  const set=await start(f,p,input),before=await prisma.exerciseSession.findUniqueOrThrow({where:{id:set.sessionId}});
  await prisma.$transaction(tx=>applyLessonPlan(tx,f.steps.id,[
    {chapterId:f.chapters[0].id,order:1,startVerse:1,endVerse:4,exerciseIds:[]},
    {chapterId:f.chapters[1].id,order:2,startVerse:1,endVerse:4,exerciseIds:[]},
  ]));
  const after=await prisma.exerciseSession.findUniqueOrThrow({where:{id:set.sessionId}});
  assert.deepEqual(after.nativeContext,before.nativeContext);
  assert.deepEqual(after.result,before.result);
  assert.notEqual(after.courseLessonId,before.courseLessonId);
  assert.equal(after.courseLessonId,f.steps.lessons[1].id);
  assert.equal((await call(f,p+"/sessions/"+set.sessionId)).status,404);
  assert.equal((await call(f,p+"/read",{...input,actionId:randomUUID()})).status,404);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).xpTotal,0);
});

test("verouderde lege procescache mag nieuwe vragen niet overslaan bij expliciete afronding",async()=>{
  const f=await fixture("nl",false);
  // Warm het plan in het afzonderlijke HTTP-serverproces, niet deze testclient.
  await ok(await call(f,route(f).replace(/\/learning$/,"")));
  const verse=await prisma.verse.findFirstOrThrow({where:{chapterId:f.chapters[1].id,number:1}});
  await prisma.exercise.create({data:{chapterId:verse.chapterId,sourceVerseId:verse.id,order:1,type:"TRUE_FALSE",verseRef:"Alma 32:1",prompt:"Nieuwe synthetische vraag",answers:'["true"]'}});
  const before=await snapshot(f.user.id);
  assert.equal((await call(f,route(f)+"/read",{...scope(f),actionId:randomUUID()})).status,409);
  assert.deepEqual(await snapshot(f.user.id),before);
  const set=await start(f);
  assert.equal(set.exercises.length,1);
});

test("nieuwe vraaginsert wacht op de hoofdstukcommit; vragenloos afronden ziet geen tussentijdse phantom",async()=>{
  const f=await fixture("nl",false),db=new pg.Client({connectionString:database.href});await db.connect();
  let request:Promise<Response>|undefined,insert:Promise<unknown>|undefined;
  const key=7326011;
  try {
    await db.query(`CREATE FUNCTION b3c_pause_read() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId"='${f.user.id}' THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN NEW; END $$`);
    await db.query('CREATE TRIGGER b3c_pause_read BEFORE INSERT ON "StreakActivity" FOR EACH ROW EXECUTE FUNCTION b3c_pause_read()');
    await db.query('SELECT pg_advisory_lock($1)',[key]);
    request=call(f,route(f)+"/read",{...scope(f),actionId:randomUUID()});
    await waiting(db,"StreakActivity");
    const verse=await prisma.verse.findFirstOrThrow({where:{chapterId:f.chapters[1].id,number:1}});
    insert=prisma.exercise.create({data:{chapterId:verse.chapterId,sourceVerseId:verse.id,order:1,type:"TRUE_FALSE",verseRef:"Alma 32:1",prompt:"Na commit toegevoegd",answers:'["true"]'}}).then(x=>x);
    await waiting(db,"Exercise");
    await db.query('SELECT pg_advisory_unlock($1)',[key]);
    await ok(await request);
    await insert;
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).xpTotal,0);
    assert.equal(await prisma.streakActivity.count({where:{userId:f.user.id,key:`read-step:${f.steps.lessons[1].id}`}}),1);
  } finally {
    await db.query('SELECT pg_advisory_unlock_all()');
    if(request)await request.catch(()=>{});if(insert)await insert.catch(()=>{});
    await db.query('DROP TRIGGER IF EXISTS b3c_pause_read ON "StreakActivity"');await db.query('DROP FUNCTION IF EXISTS b3c_pause_read()');await db.end();
  }
});

test("gelijktijdige web/native vragenloze afronding gebruikt dezelfde User-lockvolgorde en één reeksclaim",async()=>{
  const {completeReadingOnlyStep}=await import("../src/lib/readingLessons");
  const f=await fixture("nl",false);
  const [native,web]=await Promise.all([
    call(f,route(f)+"/read",{...scope(f),actionId:randomUUID()}).then(ok),
    completeReadingOnlyStep(f.user.id,f.steps.lessons[1].id),
  ]);
  assert.equal(native.outcome.nextLessonId,web.nextLessonId);
  assert.equal(await prisma.streakActivity.count({where:{userId:f.user.id,key:`read-step:${f.steps.lessons[1].id}`}}),1);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).xpTotal,0);
  assert.equal(await prisma.userCourseLessonProgress.count({where:{userId:f.user.id,lessonId:f.steps.lessons[1].id,completed:true}}),1);
});

test("vraagretirement verlaagt historische beloning niet en herpublicatie betaalt de basis niet dubbel",async()=>{
  const f=await fixture(),course=f.courses.find(c=>c.type==="FREE_CHOICE")!,p=route(f,"chapters",course.id,f.chapters[1].id),input=scope(f,1,4);
  async function finish(){const set=await start(f,p,input);return ok(await call(f,p+"/submit",{...input,sessionId:set.sessionId,answers:answers(set)}));}
  const first=await finish();assert.equal(first.outcome.xpEarned,50);
  const exercises=await prisma.exercise.findMany({where:{chapterId:f.chapters[1].id},orderBy:{order:"asc"}});
  await prisma.exercise.updateMany({where:{id:{in:exercises.slice(2).map(e=>e.id)}},data:{status:"RETIRED"}});
  const smaller=await finish();assert.equal(smaller.outcome.baseXp,0);assert.equal(smaller.outcome.repeatXp,2);
  const progress=await prisma.contentProgress.findFirstOrThrow({where:{userId:f.user.id,lastChapterId:f.chapters[1].id}});
  assert.equal(progress.rewardCorrect,3);assert.equal(progress.baseXpEarned,50);
  await prisma.exercise.updateMany({where:{chapterId:f.chapters[1].id},data:{status:"APPROVED"}});
  const restored=await finish();assert.equal(restored.outcome.baseXp,0);assert.equal(restored.outcome.bonusXp,0);assert.equal(restored.outcome.repeatXp,3);
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:f.user.id}})).xpTotal,55);
});

test("alle bestaande schriftvraagtypen behouden uitdeelvorm en serverbeoordeling zonder voortijdige correctheid",async()=>{
  for(const type of ["FILL_BLANK","WORD_BANK","TRUE_FALSE","MULTIPLE_CHOICE","SEQUENCE"] as const) {
    const f=await fixture("nl",false),verse=await prisma.verse.findFirstOrThrow({where:{chapterId:f.chapters[1].id,number:1}});
    const accepted=type==="TRUE_FALSE"?["true"]:type==="SEQUENCE"?["eerste","tweede"]:["woord"];
    await prisma.exercise.create({data:{chapterId:verse.chapterId,sourceVerseId:verse.id,order:1,type,verseRef:"Alma 32:1",prompt:"Synthetische vraag",answers:JSON.stringify(accepted),...(type==="WORD_BANK"?{wordBank:'["woord","anders"]'}:{}),...(type==="MULTIPLE_CHOICE"?{options:{create:[{label:"woord",isCorrect:true,order:1},{label:"anders",isCorrect:false,order:2}]}}:{})}});
    const set=await start(f);assert.equal(set.exercises.length,1);assert.equal(set.exercises[0].type,type);
    assert.equal(JSON.stringify(set).includes("correctAnswer"),false);assert.equal(JSON.stringify(set).includes("isCorrect"),false);
    const result=await ok(await call(f,route(f)+"/check",{...scope(f),sessionId:set.sessionId,exerciseId:set.exercises[0].id,given:accepted}));
    assert.equal(result.correct,true);assert.deepEqual(result.correctAnswer,accepted);
    const submitted=await ok(await call(f,route(f)+"/submit",{...scope(f),sessionId:set.sessionId,answers:[{exerciseId:set.exercises[0].id,given:accepted}]}));
    assert.equal(submitted.outcome.scorePercent,100);
  }
});
