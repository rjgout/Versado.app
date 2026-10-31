import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { issueNativeSession, nativeSessionIdentity } from "../src/lib/native/sessions";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { nativeStudyImageSchema } from "../src/lib/native/studyMediaContract";
import { seedNativeStudyMedia } from "./fixtures/native-study-media";
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),base=process.env.NATIVE_TEST_BASE_URL!;
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||process.env.DATABASE_URL!==database.href||process.env.STUDY_PUBLICATION_PROFILE!=="synthetic-test"||process.env.STUDY_MEDIA_TEST_ROOT!==process.env.STUDY_MEDIA_DIR)throw Error("Eigen synthetische database/media vereist");
let fixture:Awaited<ReturnType<typeof seedNativeStudyMedia>>,mediaId:string;
async function account(){const user=await prisma.user.create({data:{email:`${randomUUID()}@example.invalid`,handle:`Beeld${randomUUID().slice(0,6)}`,discriminator:"01",passwordHash:"synthetic",emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),timeZone:"UTC",uiLanguage:"nl",xpTotal:19,hintBalance:4}});await fixture.attach(user.id);const current=await prisma.user.findUniqueOrThrow({where:{id:user.id}});return{user:current,pair:await issueNativeSession(user.id,current.sessionVersion)};}
async function call(token:string|undefined,id=mediaId,extra={},method="GET"){return fetch(`${base}/api/v1/native/study-media/${id}`,{method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1","x-real-ip":"127.0.0.92",...(token?{Authorization:`Bearer ${token}`} :{}),...(method==="GET"?{}:{"Content-Type":"application/json"}),...extra},...(method==="GET"?{}:{body:"{}"})});}
before(async()=>{fixture=await seedNativeStudyMedia();const user=await prisma.user.create({data:{email:`${randomUUID()}@example.invalid`,handle:"Mediafixture",discriminator:"01",passwordHash:"synthetic"}});mediaId=(await fixture.attach(user.id)).mediaId;});
after(async()=>{if(fixture)await prisma.contentCollection.update({where:{id:fixture.key},data:{enabled:false}});await prisma.$disconnect();});
test("same authorized source becomes a bounded verified WebP envelope, with no progress or file writes",async()=>{
 const {user,pair}=await account(),before=await prisma.user.findUniqueOrThrow({where:{id:user.id}}),media=await prisma.contentMedia.findUniqueOrThrow({where:{id:mediaId}}),file=path.join(process.env.STUDY_MEDIA_DIR!,media.storageKey),original=await fs.readFile(file);
 const response=await call(pair.accessToken);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 const value=nativeStudyImageSchema.parse(await response.json()),bytes=Buffer.from(value.base64,'base64');assert.equal(value.userId,user.id);assert.equal(value.mediaId,mediaId);assert.equal(value.selectionVersion,user.contentSelectionVersion);assert.equal(value.byteSize,bytes.length);assert.equal(value.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(value.sourceChecksum,media.checksum);assert.ok(bytes.length<=262144);const decoded=await sharp(bytes).metadata();assert.equal(decoded.format,'webp');assert.ok(decoded.width!<=640&&decoded.height!<=640);
 assert.deepEqual(await fs.readFile(file),original);assert.deepEqual(await prisma.user.findUniqueOrThrow({where:{id:user.id}}),before);assert.equal(await prisma.contentProgress.count({where:{userId:user.id}}),0);assert.equal(await prisma.userCourseProgress.count({where:{userId:user.id}}),0);
 assert.equal(JSON.stringify(value).includes(media.storageKey),false);assert.equal(JSON.stringify(value).includes(user.email),false);
 const web=await fetch(`${base}/api/study-media/${mediaId}`,{headers:{Cookie:`${SESSION_COOKIE}=${await createSessionToken(user.id)}`}});assert.equal(web.status,200);assert.deepEqual(Buffer.from(await web.arrayBuffer()),original);
});
test("no cookie fallback, exact GET/method/ID only, no preview or general file proxy",async()=>{
 const {user,pair}=await account();assert.equal((await call(undefined,mediaId,{Cookie:`${SESSION_COOKIE}=${await createSessionToken(user.id)}`})).status,401);
 for(const method of ['POST','DELETE'])assert.equal((await call(pair.accessToken,mediaId,{},method)).status,404);
 for(const id of ['missing',`${mediaId}/preview`,'https%3A%2F%2Fevil.invalid','a'.repeat(129)])assert.ok([400,404].includes((await call(pair.accessToken,id)).status));
 assert.equal((await call(pair.accessToken,`${mediaId}?preview=1`)).status,400);assert.equal((await call(pair.accessToken,mediaId,{Origin:'https://evil.invalid'})).status,403);
 const identity=await nativeSessionIdentity(pair.accessToken);await prisma.nativeSession.update({where:{id:identity.binding.sessionId},data:{revokedAt:new Date()}});assert.equal((await call(pair.accessToken)).status,401);
});
test("hidden, draft, disabled, retired and unpublished content never yields private media",async()=>{
 const {pair}=await account();
 for(const patch of [{visibleToUsers:false},{visibleToUsers:true,publicationState:'DRAFT' as const},{publicationState:'PUBLISHED' as const,enabled:false}]){await prisma.contentCollection.update({where:{id:fixture.key},data:patch});assert.equal((await call(pair.accessToken)).status,404);}
 await prisma.contentCollection.update({where:{id:fixture.key},data:{enabled:true,visibleToUsers:true,publicationState:'PUBLISHED'}});
 const lessons=fixture.items.map(i=>i.edition.lessonId);await prisma.studyLesson.updateMany({where:{id:{in:lessons}},data:{retiredAt:new Date()}});assert.equal((await call(pair.accessToken)).status,404);await prisma.studyLesson.updateMany({where:{id:{in:lessons}},data:{retiredAt:null}});
 await prisma.studyLessonEdition.updateMany({where:{collectionId:fixture.key},data:{publishedRevisionId:null}});assert.equal((await call(pair.accessToken)).status,404);for(const item of fixture.items)await prisma.studyLessonEdition.update({where:{id:item.lessonEditionId},data:{publishedRevisionId:item.revisionId}});
 assert.equal((await call(pair.accessToken)).status,200);
});
test("corrupt source bytes, size metadata and non-READY media remain rejected by existing storage checks",async()=>{
 const {pair}=await account(),media=await prisma.contentMedia.findUniqueOrThrow({where:{id:mediaId}}),file=path.join(process.env.STUDY_MEDIA_DIR!,media.storageKey),bytes=await fs.readFile(file);
 const mode=(await fs.stat(file)).mode&0o777;
 // Alleen het eigen synthetische fixturebestand tijdelijk beschadigen; de
 // importer beschermt ook dit testbestand terecht met readonly-modus 0440.
 try{await fs.chmod(file,0o600);await fs.writeFile(file,Buffer.from('synthetic damaged source'));assert.equal((await call(pair.accessToken)).status,404);}finally{await fs.writeFile(file,bytes);await fs.chmod(file,mode);}
 // Ook gelijke grootte met andere bytes moet de gepinde hash afwijzen.
 try{await fs.chmod(file,0o600);const changed=Buffer.from(bytes);changed[changed.length-1]^=1;await fs.writeFile(file,changed);assert.equal((await call(pair.accessToken)).status,404);}finally{await fs.writeFile(file,bytes);await fs.chmod(file,mode);}
 await assert.rejects(prisma.contentMedia.update({where:{id:mediaId},data:{byteSize:media.byteSize+1}}),/STUDY_MEDIA_IMMUTABLE/);
 await assert.rejects(prisma.contentMedia.update({where:{id:mediaId},data:{status:'STAGED'}}),/STUDY_MEDIA_IMMUTABLE/);
 const checksum=createHash('sha256').update(randomUUID()).digest('hex');
 const staged=await prisma.contentMedia.create({data:{checksum,storageKey:`${checksum}.png`,byteSize:bytes.length,width:media.width,height:media.height,mimeType:media.mimeType,volumeId:media.volumeId,sourceMetadata:{sourceKey:'fixture:unpublished-native-media',adapter:'synthetic-v1'},rightsMetadata:{holder:'Testfixture',permission:'Alleen geïsoleerde test'},status:'STAGED'}});
 assert.equal((await call(pair.accessToken,staged.id)).status,404);
 assert.equal((await call(pair.accessToken)).status,200);
});
async function blocked(change:(userId:string,sessionId:string)=>Promise<unknown>,status:number){
 const {user,pair}=await account(),identity=await nativeSessionIdentity(pair.accessToken),lock=new pg.Client({connectionString:database.href});await lock.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE "ContentMedia" IN ACCESS EXCLUSIVE MODE');let pending:Promise<Response>|undefined;
 try{pending=call(pair.accessToken);let waiting=false;for(let i=0;i<100;i++){const rows=await lock.query(`SELECT 1 FROM pg_locks WHERE NOT granted AND relation='"ContentMedia"'::regclass AND pid<>pg_backend_pid()`);if(rows.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.equal(waiting,true,'Echte mediacontrole moet geblokkeerd zijn');await change(user.id,identity.binding.sessionId);await lock.query('COMMIT');const response=await pending;assert.equal(response.status,status);const value=await response.json();assert.equal('base64' in value,false);
 }finally{await lock.query('ROLLBACK');await lock.end();if(pending)await pending.catch(()=>{});}
}
test("revocation or content selection changes while a real media read waits reject the late bytes",async()=>{
 await blocked(async(_user,session)=>prisma.nativeSession.update({where:{id:session},data:{revokedAt:new Date()}}),401);
 await blocked(async user=>prisma.user.update({where:{id:user},data:{activeContentCollectionId:null}}),409);
});
test("publication/access withdrawal during a delayed read is checked again before response",async()=>{
 try{await blocked(async()=>prisma.contentCollection.update({where:{id:fixture.key},data:{visibleToUsers:false}}),404);}finally{await prisma.contentCollection.update({where:{id:fixture.key},data:{visibleToUsers:true}});}
});
