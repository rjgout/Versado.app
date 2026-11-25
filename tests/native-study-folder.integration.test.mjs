import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import pg from "pg";
import {prisma} from "../src/lib/db.ts";
import {seedNativeCourses} from "./fixtures/native-courses.ts";
import {issueNativeSession,nativeSessionIdentity} from "../src/lib/native/sessions.ts";
import {createSessionToken,SESSION_COOKIE} from "../src/lib/auth.ts";
import {mutateAnnotation} from "../src/lib/annotations/service.ts";
import {mutateNativeFolderAnnotation} from "../src/lib/native/studyFolder.server.ts";
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),base=process.env.NATIVE_TEST_BASE_URL;
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||database.href!==process.env.DATABASE_URL)throw Error("Uitsluitend eigen geïsoleerde PostgreSQL");
const ownedCollections=[];
async function ownFixture(promise){const value=await promise;ownedCollections.push(value.collection.id);return value;}
let f,other,verse,otherVerse;
before(async()=>{f=await ownFixture(seedNativeCourses());other=await ownFixture(seedNativeCourses("en"));verse=await prisma.verse.findFirstOrThrow({where:{chapterId:f.chapters[0].id},orderBy:{number:"asc"}});otherVerse=await prisma.verse.findFirstOrThrow({where:{chapterId:other.chapters[1].id},orderBy:{number:"desc"}});});
after(async()=>{await prisma.contentCollection.updateMany({where:{id:{in:ownedCollections}},data:{enabled:false}});await prisma.$disconnect();});
async function account(){const user=await f.account();return {user,pair:await issueNativeSession(user.id,user.sessionVersion),cookie:`${SESSION_COOKIE}=${await createSessionToken(user.id)}`};}
function native(who,path,method="GET",body){return fetch(`${base}/api/v1/native/${path}`,{method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1",...(who?{Authorization:`Bearer ${who.pair.accessToken}`} : {}),...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});}
function web(who,path,method="GET",body){return fetch(base+path,{method,headers:{Cookie:who.cookie,Origin:base,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});}
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());assert.match(response.headers.get("cache-control"),/no-store/);return response.json();}
const action=(kind="note",targetVerse=verse,version=0,extra={})=>({kind,target:{type:"verse",verseId:targetVerse.id},expectedVersion:version,actionId:randomUUID(),...(kind==="note"?{text:"Privé notitie"}:{}),...extra});
async function create(who,kind="note",v=verse,extra={}){return (await json(await web(who,"/api/annotations","PUT",action(kind,v,0,extra)))).annotation;}
const ref=row=>({kind:row.kind,id:row.id});
const path=(row,part="annotations")=>`study-folder/${row.kind}/${row.id}/${part}`;
const wire=(row,operation="put",extra={})=>({ref:ref(row),targetKey:row.targetKey,operation,action:{kind:row.kind,expectedVersion:row.mutationVersion,actionId:randomUUID(),...(operation==="put"&&row.kind==="note"?{text:"Gewijzigde privénotitie"}:{}),...extra}});
async function query(who,input={}){return (await json(await native(who,"study-folder/query","POST",input))).data;}

test("web en native delen eigen accountbrede gegevens, legacy-identiteiten en alle kleuren",async()=>{
 const who=await account(),foreign=await account(),mine=await create(who),bookmark=await create(who,"bookmark",otherVerse);
 await create(foreign,"note",verse,{text:"GEHEIM VAN ANDER ACCOUNT"});const legacy=await prisma.bookmark.create({data:{userId:who.user.id,verseId:verse.id}});
 const a=await query(who),b=await json(await web(who,"/api/study-folder"));assert.deepEqual(a,b);assert.equal(a.items.length,3);assert.ok(a.items.some(i=>i.id===legacy.id));assert.ok(a.items.some(i=>i.id===bookmark.id));assert.ok(!JSON.stringify(a).includes("GEHEIM VAN ANDER ACCOUNT"));
 assert.deepEqual(await query(who,{view:"sources"}),await json(await web(who,"/api/study-folder?view=sources")));assert.equal((await query(who,{q:"Privé",type:"note",source:f.collection.id})).items[0].id,mine.id);
 for(const color of ["yellow","green","blue","pink","purple"]){const current=await prisma.highlight.findFirst({where:{userId:who.user.id,verseId:verse.id}});await json(await web(who,"/api/annotations","PUT",action("highlight",verse,current?.mutationVersion??0,{color})));assert.equal((await query(who,{color})).items[0].color,color);}
 assert.equal((await query(who,{type:"bookmark"})).items.length,2);
});
test("paginering en cursors zijn strikt aan filters en gebruiker gebonden",async()=>{
 const who=await account(),foreign=await account();await create(who);await create(who,"bookmark");await create(who,"highlight");let cursor,ids=[];
 do{const data=await query(who,{limit:1,...(cursor?{cursor}:{})});ids.push(...data.items.map(i=>i.id));cursor=data.nextCursor;}while(cursor);assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
 const first=await query(who,{limit:1});for(const input of [{cursor:first.nextCursor,type:"note"},{cursor:"!!"},{color:"yellow",type:"note"},{limit:51},{userId:foreign.user.id},{view:"sources",q:"x"}])await json(await native(who,"study-folder/query","POST",input),400);await json(await native(foreign,"study-folder/query","POST",{cursor:first.nextCursor}),400);
});
test("bewerken, kleurwijziging, verwijderen, idempotentie, conflict en expliciete tombstone-readback",async()=>{
 const who=await account(),row=await create(who),body=wire(row),updated=await json(await native(who,"study-folder/annotations","POST",body));assert.equal(updated.annotation.mutationVersion,2);assert.equal((await json(await native(who,"study-folder/annotations","POST",body))).changed,false);await json(await native(who,"study-folder/annotations","POST",wire(row)),409);
 assert.equal((await json(await web(who,`/api/study-folder?item=note:${row.id}`))).item.text,body.action.text);
 const deletion=wire(updated.annotation,"delete");await json(await native(who,"study-folder/annotations","POST",deletion));assert.equal((await query(who)).items.length,0);const readback=await json(await native(who,path(row)));assert.equal(readback.annotations.find(i=>i.id===row.id).deleted,true);assert.equal((await json(await native(who,"study-folder/annotations","POST",deletion))).changed,false);
 const marked=await create(who,"highlight");assert.equal((await json(await native(who,"study-folder/annotations","POST",wire(marked,"put",{color:"purple"})))).annotation.color,"purple");
});
test("geen cookie-authfallback, vreemde refs, extra target, queryparameters of onbevoegde mutaties",async()=>{
 const who=await account(),foreign=await account(),row=await create(who);await json(await native(null,"study-folder/query","POST",{}),401);
 await json(await fetch(`${base}/api/v1/native/study-folder/query`,{method:"POST",headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1","Content-Type":"application/json",Cookie:who.cookie},body:"{}"}),401);
 for(const suffix of ["annotations","passage"])await json(await native(foreign,path(row,suffix)),404);await json(await native(foreign,"study-folder/annotations","POST",wire(row)),404);
 await json(await native(who,"study-folder/annotations","POST",{...wire(row),targetKey:`verse:${otherVerse.id}`}),400);await json(await native(who,"study-folder/annotations","POST",{...wire(row),action:{...wire(row).action,target:{type:"verse",verseId:otherVerse.id}}}),400);await json(await native(who,"study-folder/query?q=private","POST",{}),400);
 await json(await fetch(`${base}/api/v1/native/study-folder/query`,{method:"POST",headers:{Origin:"https://untrusted.invalid","X-Versado-Client":"native-v1","Content-Type":"application/json",Authorization:`Bearer ${who.pair.accessToken}`},body:"{}"}),403);
});
test("exacte andere taaluitgave opent zonder bron, taal, cursussen, XP of voortgang te wijzigen",async()=>{
 const who=await account(),row=await create(who,"note",otherVerse),before=await prisma.user.findUniqueOrThrow({where:{id:who.user.id}}),progress=await prisma.contentProgress.findMany({where:{userId:who.user.id}}),courses=await prisma.userCourseProgress.findMany({where:{userId:who.user.id}});
 const result=await json(await native(who,path(row,"passage")));assert.equal(result.destination.status,"ready");const reader=result.destination.reader;assert.equal(reader.collectionId,other.collection.id);assert.equal(reader.language,"en");assert.equal(reader.chapterId,otherVerse.chapterId);assert.equal(reader.focusVerse,otherVerse.number);assert.ok(reader.verses.some(v=>v.id===otherVerse.id));await query(who,{q:"Privé"});await json(await native(who,"study-folder/annotations","POST",wire(row)));
 assert.deepEqual(await prisma.user.findUniqueOrThrow({where:{id:who.user.id}}),before);assert.deepEqual(await prisma.contentProgress.findMany({where:{userId:who.user.id}}),progress);assert.deepEqual(await prisma.userCourseProgress.findMany({where:{userId:who.user.id}}),courses);
});
test("verborgen en DRAFT bronnen lekken geen bronmetadata/tekst; eigen privénotitie blijft beheerbaar",async()=>{
 const local=await ownFixture(seedNativeCourses()),who=await account(),v=await prisma.verse.findFirstOrThrow({where:{chapterId:local.chapters[0].id}}),row=await create(who,"note",v);
 for(const data of [{visibleToUsers:false},{visibleToUsers:true,publicationState:"DRAFT"},{enabled:false,publicationState:"PUBLISHED"}]){await prisma.contentCollection.update({where:{id:local.collection.id},data});const item=(await query(who)).items[0];assert.deepEqual(item.source,{status:"unavailable"});assert.equal(item.snippet,undefined);assert.equal(item.text,"Privé notitie");assert.equal((await query(who,{source:local.collection.id})).items.length,0);assert.equal((await query(who,{q:local.collection.name})).items.length,0);assert.deepEqual((await json(await native(who,path(row,"passage")))).destination,{status:"unavailable"});}
 assert.equal((await json(await native(who,"study-folder/annotations","POST",wire(row)))).annotation.text,"Gewijzigde privénotitie");
});
test("OTB wordt geen onbedoelde tweede native Bijbellezer",async()=>{
 const local=await ownFixture(seedNativeCourses()),who=await account(),v=await prisma.verse.findFirstOrThrow({where:{chapterId:local.chapters[0].id}}),row=await create(who,"bookmark",v);await prisma.contentWork.upsert({where:{key:"old-testament"},create:{key:"old-testament",kind:"SCRIPTURE"},update:{}});await prisma.contentCollection.update({where:{id:local.collection.id},data:{work:"old-testament"}});
 const result=await json(await native(who,path(row,"passage")));assert.deepEqual(result.destination,{status:"unsupported",kind:"scripture"});assert.equal(result.destination.reader,undefined);
});
test("verlopen, ingetrokken en gewisselde sessieversies weigeren reads en writes",async()=>{
 for(const reason of ["expired","revoked","version"]){const who=await account(),row=await create(who),identity=await nativeSessionIdentity(who.pair.accessToken);if(reason==="version")await prisma.user.update({where:{id:who.user.id},data:{sessionVersion:{increment:1}}});else await prisma.nativeSession.update({where:{id:identity.binding.sessionId},data:reason==="expired"?{createdAt:new Date(Date.now()-60000),expiresAt:new Date(Date.now()-1000)}:{revokedAt:new Date()}});await json(await native(who,"study-folder/query","POST",{}),401);await json(await native(who,path(row)),401);await json(await native(who,"study-folder/annotations","POST",wire(row)),401);}
});
test("sessie-intrekking tijdens User-lockwachten voorkomt late mutatiecommit",async()=>{
 const who=await account(),row=await create(who),{binding}=await nativeSessionIdentity(who.pair.accessToken),lock=new pg.Client({connectionString:process.env.DATABASE_URL});await lock.connect();
 try{await lock.query("BEGIN");await lock.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE',[who.user.id]);const pending=mutateNativeFolderAnnotation(binding,wire(row)),outcome=pending.then(value=>({value}),error=>({error}));let waiting=false;for(let n=0;n<80;n++){await lock.query("SELECT pg_stat_clear_snapshot()");const result=await lock.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%User%' AND pid<>pg_backend_pid()");if(result.rowCount){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(waiting);await lock.query('UPDATE "NativeSession" SET "revokedAt"=now() WHERE id=$1',[binding.sessionId]);await lock.query("COMMIT");assert.equal((await outcome).error?.status,401);assert.equal((await prisma.note.findUniqueOrThrow({where:{id:row.id}})).mutationVersion,1);}finally{await lock.query("ROLLBACK");await lock.end();}
});
test("gelijktijdige schrijvers behouden optimistic concurrency en één bevestigde versie",async()=>{
 const who=await account(),row=await create(who),results=await Promise.all([native(who,"study-folder/annotations","POST",wire(row)),native(who,"study-folder/annotations","POST",wire(row))]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await prisma.note.findUniqueOrThrow({where:{id:row.id}})).mutationVersion,2);
});
test("studieannotaties bewaren oorspronkelijke revisie en quote; hun leesbestemming faalt eerlijk",async()=>{
 const {referenceFixture}=await import("./fixtures/reference-content.mjs"),{passageBlocks}=await import("../src/lib/annotations/contract.ts"),fixture=await ownFixture(referenceFixture()),section=fixture.dto.lesson.body.sections[0],block=passageBlocks(fixture.dto.lesson.body,section.id)[0];
 const target={type:"lesson",lessonEditionId:fixture.item.lessonEditionId,revisionId:fixture.item.revisionId,selector:{normalizationVersion:1,originalRevisionId:fixture.item.revisionId,sectionAnchor:section.id,ranges:[{blockId:block.id,start:0,end:[...block.text].length}],exact:block.text,prefix:"",suffix:""}},who={...fixture.owner,pair:await issueNativeSession(fixture.owner.user.id,fixture.owner.user.sessionVersion)},row=(await mutateAnnotation(who.actor,{kind:"note",target,expectedVersion:0,actionId:randomUUID(),text:"Eigen studienotitie"},false)).annotation,before=await prisma.note.findUniqueOrThrow({where:{id:row.id}});
 assert.deepEqual((await query(who)).items.find(i=>i.id===row.id).target,target);const opened=await json(await native(who,path(row,"passage")));assert.deepEqual(opened.destination,{status:"unsupported",kind:"study"});assert.equal(opened.item.quote,block.text);await json(await native(who,"study-folder/annotations","POST",wire(row)));const after=await prisma.note.findUniqueOrThrow({where:{id:row.id}});for(const key of ["id","targetKey","revisionId","lessonEditionId","selector","verseId"])assert.deepEqual(after[key],before[key]);assert.equal(after.text,"Gewijzigde privénotitie");
});
test("bronintrekking staat verwijderen toe maar maakt geen nieuwe notities of markeringen mogelijk",async()=>{
 const local=await ownFixture(seedNativeCourses()),who=await account(),v=await prisma.verse.findFirstOrThrow({where:{chapterId:local.chapters[0].id}}),row=await create(who,"bookmark",v);await prisma.contentCollection.update({where:{id:local.collection.id},data:{visibleToUsers:false}});
 for(const kind of ["note","highlight"])await json(await native(who,"study-folder/annotations","POST",wire(row,"put",{kind,...(kind==="note"?{text:"niet toegestaan"}:{color:"blue"})})),404);assert.equal(await prisma.note.count({where:{userId:who.user.id,verseId:v.id}}),0);assert.equal(await prisma.highlight.count({where:{userId:who.user.id,verseId:v.id}}),0);await json(await native(who,"study-folder/annotations","POST",wire(row,"delete")));assert.ok((await prisma.bookmark.findUniqueOrThrow({where:{id:row.id}})).deletedAt);
});
