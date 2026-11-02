import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { seedNativeCourses } from "./fixtures/native-courses";
import { issueNativeSession,nativeSessionIdentity } from "../src/lib/native/sessions";
import { createSessionToken,SESSION_COOKIE } from "../src/lib/auth";
import { nativeReaderSchema,type NativeReader } from "../src/lib/native/readerContract";
import { nativeAnnotationContext,nativeAnnotationList,nativeAnnotationMutation } from "../src/lib/native/annotationsContract";
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),base=process.env.NATIVE_TEST_BASE_URL!;
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||database.href!==process.env.DATABASE_URL)throw Error("Uitsluitend geïsoleerde PostgreSQL");
let f:Awaited<ReturnType<typeof seedNativeCourses>>;
before(async()=>{f=await seedNativeCourses();});
after(async()=>{await prisma.contentCollection.update({where:{id:f.collection.id},data:{enabled:false}});await prisma.$disconnect();});
async function account(){const user=await f.account();return {user,pair:await issueNativeSession(user.id,user.sessionVersion)};}
function route(courseId=f.steps.id,kind="steps",targetId=f.steps.lessons[1].id){return `courses/${courseId}/read/${kind}/${targetId}`;}
function request(token:string|undefined,path:string,method="GET",body?:unknown,headers:Record<string,string>={}){return fetch(`${base}/api/v1/native/${path}`,{method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1",...(token?{Authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{"Content-Type":"application/json"}),...headers},body:body===undefined?undefined:JSON.stringify(body)});}
async function reader(token:string,path=route()){const response=await request(token,path);assert.equal(response.status,200,await response.clone().text());return nativeReaderSchema.parse(await response.json());}
function action(value:NativeReader,kind:"bookmark"|"highlight"|"note"="bookmark",version=0,extra:Record<string,unknown>={}){return {kind,target:{type:"verse",verseId:value.verses[0].id},expectedVersion:version,actionId:randomUUID(),...(kind==="note"?{text:"Persoonlijke notitie"}:{}),...extra};}
function input(value:NativeReader,a:ReturnType<typeof action>,operation="put"){return {operation,context:nativeAnnotationContext.parse(value),action:a};}
async function web(user:{id:string;sessionVersion:number},method:string,body?:unknown,path="/api/annotations") {
 const cookie=`${SESSION_COOKIE}=${await createSessionToken(user.id)}`;
 return fetch(base+path,{method,headers:{Cookie:cookie,Origin:base,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function unrelated(userId:string){
 const tables=await prisma.$queryRaw<{table_name:string}[]>`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='userId' AND table_name NOT IN ('Bookmark','Highlight','Note') ORDER BY table_name`;
 const rows:unknown[]=[];
 for(const {table_name:name} of tables){assert.match(name,/^[A-Za-z0-9_]+$/);rows.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM "${name}" t WHERE "userId"=$1`,userId));}
 return {user:await prisma.user.findUnique({where:{id:userId}}),rows};
}
async function annotations(token:string,path=route(),verseId?:string){const response=await request(token,path+"/annotations"+(verseId?`/${verseId}`:""));assert.equal(response.status,200,await response.clone().text());return nativeAnnotationList.parse(await response.json());}

test("alle drie de leesmethoden en vijf talen lezen dezelfde annotaties zonder GET-writes",async()=>{
 for(const language of ["nl","en","de","fr","es"]){
  const fixture=await seedNativeCourses(language),user=await fixture.account(language),pair=await issueNativeSession(user.id,user.sessionVersion);
  const before=await unrelated(user.id);
  for(const course of fixture.courses){
   const p=route(course.id,course.type==="READING_LESSONS"?"steps":"chapters",course.type==="READING_LESSONS"?fixture.steps.lessons[1].id:fixture.chapters[1].id);
   const value=await reader(pair.accessToken,p),list=await annotations(pair.accessToken,p,value.verses[0].id);
   assert.equal(list.language,language);assert.equal(list.courseId,course.id);assert.equal(list.annotations.length,0);
   assert.equal((await annotations(pair.accessToken,p)).complete,true);
   if(course.type==="READING_LESSONS")assert.equal(value.verses.length,2);else assert.equal(value.verses.length,4);
  }
  assert.deepEqual(await unrelated(user.id),before);
  await prisma.contentCollection.update({where:{id:fixture.collection.id},data:{enabled:false}});
 }
});
test("web/native delen vers-ID, vijf kleuren, volledige 2000-tekensnotitie, versies, tombstones en replay zonder andere writes",async()=>{
 const {user,pair}=await account(),value=await reader(pair.accessToken),before=await unrelated(user.id),p=route()+"/annotations";
 for(const kind of ["bookmark","highlight","note"] as const){
  const a=action(value,kind,0,kind==="note"?{text:"😀".repeat(1000)}:kind==="highlight"?{color:"yellow"}:{}),body=input(value,a);
  const first=await request(pair.accessToken,p,"POST",body);assert.equal(first.status,200,await first.clone().text());const result=await first.json();
  const again=await request(pair.accessToken,p,"POST",body);assert.equal(again.status,200);assert.equal((await again.json()).changed,false);
  const stored=(await (await web(user,"GET",undefined,`/api/annotations?view=reader&targetKey=verse:${value.verses[0].id}`)).json()).annotations.find((r:{kind:string})=>r.kind===kind);
  for(const key of ["id","kind","targetKey","text","color","mutationVersion","deleted"])assert.deepEqual(result.annotation[key],stored[key]);
 }
 for(const [index,color]of ["green","blue","pink","purple"].entries()){
  const result=await web(user,"PUT",action(value,"highlight",index+1,{color}));assert.equal(result.status,200);
  const list=await annotations(pair.accessToken,route(),value.verses[0].id);assert.equal(list.annotations.find(row=>row.kind==="highlight")?.color,color);
 }
 const note=(await annotations(pair.accessToken,route(),value.verses[0].id)).annotations.find(row=>row.kind==="note")!;assert.equal(note.text,"😀".repeat(1000));
 const removed=await request(pair.accessToken,p,"POST",input(value,action(value,"note",note.mutationVersion,{text:undefined}),"delete"));assert.equal(removed.status,200);
 const tombstone=(await annotations(pair.accessToken,route(),value.verses[0].id)).annotations.find(row=>row.kind==="note")!;assert.equal(tombstone.deleted,true);assert.equal(tombstone.id,note.id);
 const bulk=await annotations(pair.accessToken);assert.equal(bulk.annotations.some(row=>row.kind==="note"&&!row.deleted),false);assert.equal(bulk.annotations.find(row=>row.kind==="note")?.deleted,true);
 const stale=await web(user,"PUT",action(value,"note",note.mutationVersion,{text:"Verouderd"}));assert.equal(stale.status,409);
 assert.deepEqual(await unrelated(user.id),before,"READ, XP, reeks, oefensessies, cursus- en cursorvoortgang blijven identiek");
});
test("een losse leesstap kan andere verzen, cursussen of bronnen niet benaderen of hun bestaande privénotities verwijderen",async()=>{
 const {user,pair}=await account(),value=await reader(pair.accessToken);
 const outside=await prisma.verse.findFirstOrThrow({where:{chapterId:value.chapterId,number:3}});
 const ownNote={...action(value,"note"),target:{type:"verse",verseId:outside.id}};
 assert.equal((await web(user,"PUT",ownNote)).status,200);
 const count=await prisma.note.count({where:{userId:user.id}});
 assert.equal((await annotations(pair.accessToken)).annotations.some(row=>row.target.verseId===outside.id),false);
 assert.equal((await request(pair.accessToken,route()+`/annotations/${outside.id}`)).status,404);
 assert.equal((await request(pair.accessToken,route()+"/annotations","POST",input(value,ownNote))).status,404);
 assert.equal((await request(pair.accessToken,route()+"/annotations","POST",input(value,{...ownNote,text:undefined},"delete"))).status,404);
 assert.equal(await prisma.note.count({where:{userId:user.id}}),count);
 assert.equal((await request(pair.accessToken,route("unknown")+"/annotations")).status,404);
});
test("401/403/404/409, malformed invoer en webcookies kunnen de native grenzen niet passeren",async()=>{
 const {user,pair}=await account(),value=await reader(pair.accessToken),body=input(value,action(value)),p=route()+"/annotations";
 assert.equal((await request(undefined,p,"GET",undefined,{Cookie:`${SESSION_COOKIE}=${await createSessionToken(user.id)}`})).status,401);
 assert.equal((await request(pair.accessToken,p,"POST",body,{Origin:"https://evil.invalid"})).status,403);
 assert.equal((await request(pair.accessToken,p,"POST",{...body,context:{...body.context,selectionVersion:999}})).status,409);
 for(const bad of [{...body,context:{...body.context,userId:"other"}},input(value,action(value,"note",0,{text:"x".repeat(2001)})),{...body,operation:"toggle"}])assert.equal((await request(pair.accessToken,p,"POST",bad)).status,400);
 assert.equal((await request(pair.accessToken,p+"?user=other")).status,400);
 assert.equal((await request(pair.accessToken,p,"PUT",body)).status,405);
 const binding=(await nativeSessionIdentity(pair.accessToken)).binding;await prisma.nativeSession.update({where:{id:binding.sessionId},data:{revokedAt:new Date()}});
 assert.equal((await request(pair.accessToken,p,"POST",body)).status,401);assert.equal(await prisma.bookmark.count({where:{userId:user.id}}),0);
});
test("twee Node-processen met één poolverbinding claimen dezelfde annotatie precies eenmaal",async()=>{
 const {user,pair}=await account(),value=await reader(pair.accessToken),binding=(await nativeSessionIdentity(pair.accessToken)).binding,body=nativeAnnotationMutation.parse(input(value,action(value)));
 const args=JSON.stringify({binding,courseId:value.courseId,kind:value.kind,targetId:value.targetId,input:body});
 const run=()=>promisify(execFile)(process.execPath,["--import","tsx","tests/fixtures/native-annotation-worker.ts",args],{env:process.env,timeout:20000}).then(result=>JSON.parse(result.stdout));
 const results=await Promise.all([run(),run()]);assert.ok(results.every(r=>r.ok),JSON.stringify(results));
 assert.deepEqual(results.map(r=>r.result.changed).sort(),[false,true]);assert.equal(results[0].result.annotation.id,results[1].result.annotation.id);
 assert.equal(await prisma.bookmark.count({where:{userId:user.id,verseId:value.verses[0].id}}),1);
 const webAction={...body.action,actionId:randomUUID(),expectedVersion:1};
 const [native,webResult]=await Promise.all([run(),web(user,"DELETE",webAction)]);assert.equal(webResult.status,200);
 if(native.ok)assert.equal(native.result.changed,false);else assert.equal(native.error,"CONFLICT");
 const final=await prisma.bookmark.findFirstOrThrow({where:{userId:user.id,verseId:value.verses[0].id}});assert.equal(final.mutationVersion,2);assert.ok(final.deletedAt);
});
test("een databasefout rolt de annotatie terug; dezelfde actie-UUID kan daarna veilig slagen",async()=>{
 const {user,pair}=await account(),value=await reader(pair.accessToken),body=input(value,action(value,"note")),p=route()+"/annotations";
 const sql=new pg.Client({connectionString:database.href});await sql.connect();
 try{
  await sql.query("CREATE FUNCTION native_annotation_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic annotation rollback'; END $$");
  await sql.query('CREATE TRIGGER native_annotation_fault BEFORE INSERT ON "Note" FOR EACH ROW EXECUTE FUNCTION native_annotation_fault()');
  assert.equal((await request(pair.accessToken,p,"POST",body)).status,500);assert.equal(await prisma.note.count({where:{userId:user.id}}),0);
 }finally{await sql.query('DROP TRIGGER IF EXISTS native_annotation_fault ON "Note"');await sql.query('DROP FUNCTION IF EXISTS native_annotation_fault()');await sql.end();}
 assert.equal((await request(pair.accessToken,p,"POST",body)).status,200);assert.equal(await prisma.note.count({where:{userId:user.id}}),1);
});
test("logout, verloop, 2FA, wachtwoord, accountwissen, bron-ABA en taalwissel tijdens User-lockwachten verhinderen commit",async()=>{
 for(const kind of ["logout","expiry","password","setup","2fa","delete","source","language"]){
  const {user,pair}=await account(),value=await reader(pair.accessToken),body=input(value,action(value)),binding=(await nativeSessionIdentity(pair.accessToken)).binding;
  const lock=new pg.Client({connectionString:database.href});await lock.connect();let pending:Promise<Response>|undefined;
  try{
   await lock.query('BEGIN');await lock.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[user.id]);
   const xid=(await lock.query('SELECT pg_current_xact_id()::text AS xid')).rows[0].xid;
   pending=request(pair.accessToken,route()+"/annotations","POST",body);
   let waiting=false;for(let i=0;i<75;i++){if((await lock.query("SELECT 1 FROM pg_locks WHERE NOT granted AND locktype='transactionid' AND transactionid=$1::xid",[xid])).rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(waiting,"werkelijke annotatie-POST wacht op User-lock");
   if(kind==="logout")await lock.query('UPDATE "NativeSession" SET "revokedAt"=NOW() WHERE id=$1',[binding.sessionId]);
   else if(kind==="expiry")await lock.query('UPDATE "NativeSession" SET "createdAt"=NOW()-INTERVAL \'1 minute\',"expiresAt"=NOW()-INTERVAL \'1 second\' WHERE id=$1',[binding.sessionId]);
   else if(kind==="password")await lock.query('UPDATE "User" SET "sessionVersion"="sessionVersion"+1 WHERE id=$1',[user.id]);
   else if(kind==="setup")await lock.query('UPDATE "User" SET "mustChangePassword"=true WHERE id=$1',[user.id]);
   else if(kind==="2fa")await lock.query('UPDATE "User" SET "isAdmin"=true,"totpEnabled"=false WHERE id=$1',[user.id]);
   else if(kind==="delete")await lock.query('DELETE FROM "User" WHERE id=$1',[user.id]);
   else if(kind==="language")await lock.query('UPDATE "User" SET "uiLanguage"=\'en\' WHERE id=$1',[user.id]);
   else {await lock.query('UPDATE "User" SET "activeContentCollectionId"=NULL WHERE id=$1',[user.id]);await lock.query('UPDATE "User" SET "activeContentCollectionId"=$2 WHERE id=$1',[user.id,f.collection.id]);}
   await lock.query('COMMIT');const response=await pending;assert.notEqual(response.status,200,await response.clone().text());
   assert.equal(await prisma.bookmark.count({where:{userId:user.id}}),0);
  }finally{await lock.query('ROLLBACK').catch(()=>{});await pending?.catch(()=>{});await lock.end();}
 }
});
test("verborgen privénotities blijven bestaan en op web beheerbaar; native krijgt geen broninzage terug",async()=>{
 const {user,pair}=await account(),value=await reader(pair.accessToken),first=await (await web(user,"PUT",action(value,"note"))).json();
 try{
  await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:false}});
  const current=await web(user,"GET",undefined,`/api/annotations?kind=note&id=${first.annotation.id}`);assert.equal(current.status,200);
  assert.equal((await request(pair.accessToken,route()+"/annotations")).status,404);
  assert.equal((await request(pair.accessToken,route()+"/annotations","POST",input(value,action(value,"note",1,{text:undefined}),"delete"))).status,404);
  assert.equal((await web(user,"PUT",action(value,"note",1,{text:"Eigen privénotitie blijft beheerbaar"}))).status,200);
  assert.equal((await prisma.note.findUniqueOrThrow({where:{id:first.annotation.id}})).deletedAt,null);
 }finally{await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:true}});}
});

test("sessie- en bronintrekking tijdens de echte annotatiequery verwerpen het late antwoord",async()=>{
 for(const kind of ["session","source","publication"]){
  const {user,pair}=await account(),value=await reader(pair.accessToken),binding=(await nativeSessionIdentity(pair.accessToken)).binding;
  assert.equal((await web(user,"PUT",action(value,"note"))).status,200);
  const sql=new pg.Client({connectionString:database.href});await sql.connect();
  const key=765432109;let locked=false,view=false,renamed=false,pending:Promise<Response>|undefined;
  try{
   const columns=(await sql.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Note' ORDER BY ordinal_position")).rows.map(row=>{assert.match(row.column_name,/^[A-Za-z0-9_]+$/);return row.column_name==="text"?'native_annotation_read(n."text") AS "text"':`n."${row.column_name}"`;});
   await sql.query("CREATE FUNCTION native_annotation_read(value text) RETURNS text LANGUAGE plpgsql STABLE AS $$ BEGIN PERFORM pg_advisory_xact_lock(765432109); RETURN value; END $$");
   await sql.query('ALTER TABLE "Note" RENAME TO "NativeAnnotationTestNote"');renamed=true;
   await sql.query(`CREATE VIEW "Note" AS SELECT ${columns.join(',')} FROM "NativeAnnotationTestNote" n`);view=true;
   await sql.query('SELECT pg_advisory_lock($1)',[key]);locked=true;
   pending=request(pair.accessToken,route()+"/annotations");
   let waiting=false;for(let i=0;i<100;i++){if((await sql.query("SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND pid<>pg_backend_pid() AND query LIKE '%\"Note\"%' LIMIT 1")).rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(waiting,"de echte annotatieread wacht aantoonbaar");
   if(kind==="session")await prisma.nativeSession.update({where:{id:binding.sessionId},data:{revokedAt:new Date()}});
   else if(kind==="source"){await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:null}});await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:f.collection.id}});}
   else await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:false}});
   await sql.query('SELECT pg_advisory_unlock($1)',[key]);locked=false;
   const response=await pending;assert.ok([401,404,409].includes(response.status),await response.clone().text());assert.equal('annotations' in await response.json(),false);
  }finally{
   if(locked)await sql.query('SELECT pg_advisory_unlock($1)',[key]);await pending?.catch(()=>{});
   if(view)await sql.query('DROP VIEW "Note"');if(renamed)await sql.query('ALTER TABLE "NativeAnnotationTestNote" RENAME TO "Note"');
   await sql.query('DROP FUNCTION IF EXISTS native_annotation_read(text)');await sql.end();
   await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:true}});
  }
 }
});
test("het native bridgebudget kapt geen notitietekst af en meldt een onvolledige grote lijst expliciet",async()=>{
 const {user,pair}=await account(),course=f.courses.find(c=>c.type==="FREE_CHOICE")!;
 const chapter=await prisma.chapter.create({data:{bookId:f.book.id,number:80,order:80,verses:{create:Array.from({length:200},(_,i)=>({number:i+1,text:`Vers ${i+1}`}))}},include:{verses:true}});
 await prisma.courseChapter.create({data:{courseId:course.id,chapterId:chapter.id,order:80}});
 const text="😀".repeat(1000);
 await prisma.note.createMany({data:chapter.verses.map(verse=>({userId:user.id,verseId:verse.id,text}))});
 const p=route(course.id,"chapters",chapter.id),before=await unrelated(user.id),response=await request(pair.accessToken,p+"/annotations");
 assert.equal(response.status,200);const bytes=await response.text();assert.ok(Buffer.byteLength(bytes)<768*1024);
 const list=nativeAnnotationList.parse(JSON.parse(bytes));assert.equal(list.complete,false);assert.ok(list.annotations.length>0&&list.annotations.length<200);assert.ok(list.annotations.every(row=>row.text===text));
 const single=await annotations(pair.accessToken,p,chapter.verses[199].id);assert.equal(single.complete,true);assert.equal(single.annotations[0].text,text);
 assert.deepEqual(await unrelated(user.id),before);
});
