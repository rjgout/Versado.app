import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Prisma, PrismaClient, OfficialAudioTask } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { withContentImportLock, ContentImportBusyError } from "@/lib/contentImportLock";
import { chapterSourceHash, objectHash, sha256, type AudioManifest } from "./contract";
import { officialSources, pilotSources, type OfficialSource } from "./officialCatalogue";
import { downloadOfficial, validateOfficialPage, type OfficialNetwork } from "./officialDownload";
import { audioRoot, safeDirectory, readBounded, storeAudio, verifyObject } from "./storage";
import { importAudioPackage } from "./library";
import { lockAudioAdmin, lockOfficialPolicy, hasApprovedPilot } from "./officialGuard";

type Actor = { id: string; sessionVersion: number };
type DB = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const packageName = (id: string) => `admin-official-${id}`;
export const officialErrorCode = (error: unknown) => {
  const code=(error as NodeJS.ErrnoException)?.code;
  if(code==="ENOSPC")return "STORAGE_FULL";
  if(code==="EACCES"||code==="EROFS")return "STORAGE_PERMISSION";
  if(code==="ENOENT")return "STORAGE_UNAVAILABLE";
  return error instanceof Error && /^[A-Z_]{2,80}$/.test(error.message) ? error.message : "AUDIO_TASK_FAILED";
};
async function target(source: OfficialSource, db: DB) {
  if (source.legacyProtected || source.quality !== "VALIDATED") throw Error("SOURCE_PROTECTED");
  const chapter = await db.chapter.findFirst({ where: { number: source.chapterNumber, book: { key: source.bookKey, contentCollection: { work: source.work, editionKey: source.editionKey, language: source.language } } }, include: { book: true, verses: { orderBy: { number: "asc" } } } });
  if (!chapter) throw Error("TARGET_MISSING");
  if (chapterSourceHash(chapter) !== source.sourceHash || chapter.verses.length !== source.verses) throw Error("SOURCE_MISMATCH");
  if (source.language === "nl" && source.pilot && chapter.audioUrl) throw Error("LEGACY_PROTECTED");
  return chapter;
}
async function existing(source: OfficialSource, db: DB) {
  const chapter = await target(source, db);
  const segments=chapter.verses.map((v,i)=>({id:v.id,kind:"VERSE",sourceHash:sha256(v.text),start:source.starts[i],end:source.starts[i+1]??source.duration}));
  return db.audioRecording.findFirst({ where: { chapterId: chapter.id, sourceHash: source.sourceHash, sha256: source.sha256, sourceKind: "OFFICIAL",quality:{path:["status"],equals:"VALIDATED"},segments:{equals:json(segments)}, voice: { path: ["name"], equals: source.voice }, sourceMetadata: { path: ["url"], equals: source.url } } });
}
export async function requestOfficialAudio(actor: Actor, action: "download" | "register" | "resume" | "approvePilot", ids: string[], db: PrismaClient = prisma, catalogue: readonly OfficialSource[] = officialSources) {
  if (action === "approvePilot") return db.$transaction(async (tx) => {
    await lockAudioAdmin(tx, actor);
    await lockOfficialPolicy(tx);
    for (const source of pilotSources) await target(source, tx);
    const tasks = await tx.officialAudioTask.findMany({ where: { id: { in: pilotSources.map((s) => s.id) }, status: "REGISTERED" } });
    if (tasks.length !== 5 || tasks.some((t) => !t.recordingId) || await tx.audioPublication.count({ where: { recordingId: { in: tasks.map((t) => t.recordingId!) } } }) !== 5) throw Error("PILOT_REQUIRED");
    for(const task of tasks){const recording=await tx.audioRecording.findUniqueOrThrow({where:{id:task.recordingId!}});await verifyObject(recording.sha256,recording.byteSize);}
    await tx.officialAudioTask.updateMany({ where: { id: { in: tasks.map((t) => t.id) } }, data: { pilotApprovalKey: randomUUID(), pilotApprovedById: actor.id, pilotApprovedAt: new Date() } });
    return { accepted: 5 };
  });
  if (!ids.length || ids.length > 300 || new Set(ids).size !== ids.length) throw Error("INVALID_ACTION");
  const sources = ids.map((id) => { const s = catalogue.find((item)=>item.id===id); if (!s) throw Error("SOURCE_UNKNOWN"); return s; });
  return db.$transaction(async (tx) => {
    await lockAudioAdmin(tx, actor);
    await lockOfficialPolicy(tx);
    await audioRoot();
    if (sources.some((s) => !s.pilot) && !await hasApprovedPilot(tx)) throw Error("PILOT_REQUIRED");
    for (const source of sources.sort((a,b) => a.id.localeCompare(b.id))) {
      if(source.legacyProtected||source.quality!=="VALIDATED")throw Error("SOURCE_PROTECTED");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`official-task:${source.id}`}, 0))::text`;
      const task = await tx.officialAudioTask.findUnique({ where: { id: source.id } });
      if (task?.status === "RUNNING" || task?.status === "QUEUED") continue;
      try {await target(source,tx);}
      catch(error){
        const code=officialErrorCode(error);if(!["TARGET_MISSING","SOURCE_MISMATCH"].includes(code))throw error;
        if(action==="register"&&(!task||task.status!=="VALIDATED"))throw Error("DOWNLOAD_REQUIRED");
        const phase=action==="register"?"REGISTER":action==="resume"?task?.phase??"DOWNLOAD":"DOWNLOAD";
        await tx.officialAudioTask.upsert({where:{id:source.id},create:{id:source.id,actorId:actor.id,actorSessionVersion:actor.sessionVersion,status:"FAILED",phase,errorCode:code},update:{status:"FAILED",errorCode:code,actorId:actor.id,actorSessionVersion:actor.sessionVersion,phase}});
        continue;
      }
      const found = await existing(source, tx);
      if (found) {
        let present = false;
        try { await verifyObject(source.sha256, source.bytes); present = true; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if ((action === "download" || action === "resume") && !present) {
          await tx.officialAudioTask.upsert({ where: { id: source.id }, create: { id: source.id, actorId: actor.id, actorSessionVersion: actor.sessionVersion, recordingId: found.id }, update: { status: "QUEUED", phase: "DOWNLOAD", actorId: actor.id, actorSessionVersion: actor.sessionVersion, recordingId: found.id, errorCode: null } });
          continue;
        }
        await tx.officialAudioTask.upsert({ where: { id: source.id }, create: { id: source.id, actorId: actor.id, actorSessionVersion: actor.sessionVersion, status: "REGISTERED", recordingId: found.id }, update: { status: "REGISTERED", recordingId: found.id, errorCode: null } });
        continue;
      }
      if (action === "register" && (!task || task.status !== "VALIDATED")) throw Error("DOWNLOAD_REQUIRED");
      if (action === "download" && task?.status === "VALIDATED") {
        const root = await audioRoot();
        if (await cached(source,path.join(root,"official-cache",source.id))) {
          try { await verifyObject(source.sha256,source.bytes); continue; }
          catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
        }
      }
      if (action === "resume" && task?.status !== "FAILED") throw Error("RESUME_NOT_ALLOWED");
      const phase = action === "register" ? "REGISTER" : action === "resume" ? task!.phase : "DOWNLOAD";
      await tx.officialAudioTask.upsert({ where: { id: source.id }, create: { id: source.id, actorId: actor.id, actorSessionVersion: actor.sessionVersion }, update: { actorId: actor.id, actorSessionVersion: actor.sessionVersion, phase, status: "QUEUED", errorCode: null, leaseUntil: null, leaseToken: null, ...(phase === "REGISTER" ? { registrationApprovedAt: new Date() } : {}) } });
    }
    return { accepted: sources.length };
  }, { timeout: 30000 });
}
async function cached(source: OfficialSource, folder: string) {
  try { const bytes = await readBounded(path.join(folder,"audio.mp3"), source.bytes); if (bytes.length !== source.bytes || sha256(bytes) !== source.sha256) throw Error("CACHE_CORRUPT"); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function taskActor(task: OfficialAudioTask, db: PrismaClient) {
  const actor = await db.user.findUnique({ where: { id: task.actorId } });
  if (!actor?.isAdmin || actor.sessionVersion !== task.actorSessionVersion) throw Error("FORBIDDEN");
}
async function perform(task: OfficialAudioTask, token: string, signal: AbortSignal, db: PrismaClient, network: OfficialNetwork, catalogue: readonly OfficialSource[]) {
  const source = catalogue.find((s)=>s.id===task.id); if (!source) throw Error("SOURCE_UNKNOWN");
  await taskActor(task, db); const chapter = await target(source, db);
  if (!source.pilot && !await hasApprovedPilot(db)) throw Error("PILOT_REQUIRED");
  const cache = await safeDirectory(await audioRoot(),"official-cache",true), folder = await safeDirectory(cache,source.id,true);
  const checkLease = async () => { signal.throwIfAborted(); if (!await db.officialAudioTask.count({ where: { id: task.id, leaseToken: token, status: "RUNNING" } })) throw Error("LEASE_LOST"); };
  if (task.phase === "DOWNLOAD") {
    const bytes = await downloadOfficial(source.pageUrl, signal, network); validateOfficialPage(bytes,source);
    const checkedAt = task.checkedAt ?? new Date();
    const segments = Buffer.from(JSON.stringify({ schemaVersion:1,segments:chapter.verses.map((v,i) => ({ id:v.id,kind:"VERSE",sourceHash:sha256(v.text),start:source.starts[i],end:source.starts[i+1] ?? source.duration })) }));
    const report = Buffer.from(JSON.stringify({ quality:"VALIDATED",sourceHash:source.sourceHash,sha256:source.sha256,starts:source.starts,method:"PINNED_OFFICIAL_ALIGNMENT" }));
    const manifest: AudioManifest = { schemaVersion:1,packageId:packageName(task.id),collectionId:chapter.book.contentCollectionId,work:source.work,editionKey:source.editionKey,language:source.language as AudioManifest["language"],target:{kind:"CHAPTER",bookKey:source.bookKey,chapterNumber:source.chapterNumber},sourceHash:source.sourceHash,sourceKind:"OFFICIAL",source:{name:"The Church of Jesus Christ of Latter-day Saints",url:source.url,checkedAt:checkedAt.toISOString(),rights:"Officiële opname; bestaande bronvoorwaarden blijven van toepassing. Geen openbare audiomirror."},voice:{name:source.voice},audio:{file:"audio.mp3",sha256:source.sha256,bytes:source.bytes,duration:source.duration,format:"mp3"},segments:{file:"segments.json",sha256:sha256(segments)},quality:"VALIDATED",qualityReport:{file:"quality-report.json",sha256:sha256(report)} };
    let validated=false;
    if (!await cached(source,folder)) {
      try { const object = await verifyObject(source.sha256,source.bytes); await fs.link(object,path.join(folder,"audio.mp3")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (!await cached(source,folder)) {
      const name=`${token}.mp3`,temp=path.join(folder,name);
      try {
        await downloadOfficial(source.url,signal,network,temp,source.bytes,async(size)=>{
          await checkLease();await db.officialAudioTask.updateMany({where:{id:task.id,leaseToken:token},data:{bytesDownloaded:size}});
        });
        // Eerst bestaande checksum/probe/decode-validering; een foute download wordt nooit de definitieve cache.
        await storeAudio(folder,{...manifest,audio:{...manifest.audio,file:name}});validated=true;
        await checkLease();
        await fs.link(temp,path.join(folder,"audio.mp3")).catch((error:NodeJS.ErrnoException)=>{if(error.code!=="EEXIST")throw error;});
      } finally {await fs.unlink(temp).catch(()=>{});}
    }
    await cached(source,folder);
    if(!validated)await storeAudio(folder,manifest);
    await checkLease();
    await db.$transaction(async (tx) => {
      await lockAudioAdmin(tx,{id:task.actorId,sessionVersion:task.actorSessionVersion});
      const changed = await tx.officialAudioTask.updateMany({ where:{id:task.id,leaseToken:token,status:"RUNNING"},data:{status:task.recordingId?"REGISTERED":"VALIDATED",manifest:json(manifest),checkedAt,bytesDownloaded:source.bytes,errorCode:null,leaseUntil:null} });
      if (!changed.count) throw Error("LEASE_LOST");
    });
  } else {
    if (!task.manifest || !task.registrationApprovedAt) throw Error("REGISTRATION_NOT_APPROVED");
    const manifest = task.manifest as unknown as AudioManifest;
    if (!await cached(source,folder)) throw Error("CACHE_MISSING");
    const incoming = await safeDirectory(await audioRoot(),"incoming",true), destination = path.join(incoming,manifest.packageId);
    const segments = Buffer.from(JSON.stringify({schemaVersion:1,segments:chapter.verses.map((v,i)=>({id:v.id,kind:"VERSE",sourceHash:sha256(v.text),start:source.starts[i],end:source.starts[i+1]??source.duration}))}));
    const report = Buffer.from(JSON.stringify({quality:"VALIDATED",sourceHash:source.sourceHash,sha256:source.sha256,starts:source.starts,method:"PINNED_OFFICIAL_ALIGNMENT"}));
    if (sha256(segments)!==manifest.segments.sha256 || sha256(report)!==manifest.qualityReport?.sha256) throw Error("SOURCE_MISMATCH");
    await withContentImportLock(async () => {
      await checkLease(); await taskActor(task,db);
      try { await fs.lstat(destination); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code!=="ENOENT") throw error;
        const staging=await safeDirectory(await audioRoot(),"staging",true), stage=await safeDirectory(staging,`official-${task.id}-${token.slice(0,8)}`,true);
        await fs.link(path.join(folder,"audio.mp3"),path.join(stage,"audio.mp3"));
        for (const [name,content] of [["manifest.json",Buffer.from(JSON.stringify(manifest))],["segments.json",segments],["quality-report.json",report],["READY",Buffer.from("1\n")]] as const) {
          const file=await fs.open(path.join(stage,name),"wx",0o600);try{await file.writeFile(content);await file.sync();}finally{await file.close();}
        }
        await checkLease(); const dir=await fs.open(stage,"r");try{await dir.sync();}finally{await dir.close();}
        await fs.rename(stage,destination);const parent=await fs.open(incoming,"r");try{await parent.sync();}finally{await parent.close();}
      }
      const previousReceipt=await db.audioPackage.findUnique({where:{id:manifest.packageId}});
      const receipt=await importAudioPackage(destination,db);
      if (receipt.status!=="READY") {
        // Alleen een reeds bestaande back-off/andere worker afwachten. Een nieuwe fout blijft expliciet FAILED.
        const waiting=receipt.status==="PROCESSING"||(receipt.status==="FAILED"&&previousReceipt?.leaseToken===receipt.leaseToken&&previousReceipt.attempts===receipt.attempts);
        if(waiting&&receipt.leaseUntil>new Date()){
          await db.officialAudioTask.updateMany({where:{id:task.id,leaseToken:token},data:{status:"QUEUED",leaseUntil:receipt.leaseUntil,errorCode:null}});
          return;
        }
        throw Error(receipt.errorCode??"REGISTRATION_BUSY");
      }
      const recording=await existing(source,db);if(!recording)throw Error("RECORDING_MISSING");
      await db.officialAudioTask.updateMany({where:{id:task.id,leaseToken:token},data:{status:"REGISTERED",recordingId:recording.id,errorCode:null,leaseUntil:null}});
    });
  }
}
/** Eén begrensde worker voor alle appcontainers. Alleen de eigen PostgreSQL-verbinding bepaalt eigenaarschap. */
export async function runOfficialAudioTick(db: PrismaClient = prisma, network: OfficialNetwork = {}, catalogue: readonly OfficialSource[] = officialSources) {
  if (!process.env.AUDIO_DIR || !process.env.DATABASE_URL) return;
  const owner=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000,keepAlive:true}),abort=new AbortController();
  owner.on("error",()=>abort.abort());await owner.connect();
  try {
    const lock=await owner.query<{ok:boolean}>("SELECT pg_try_advisory_lock(726540107) AS ok");if(!lock.rows[0]?.ok)return;
    const started=Date.now();
    for(let n=0;n<5 && Date.now()-started<45000;n++) {
      abort.signal.throwIfAborted();
      const task=await db.officialAudioTask.findFirst({where:{OR:[{status:"QUEUED",OR:[{leaseUntil:null},{leaseUntil:{lte:new Date()}}]},{status:"RUNNING",leaseUntil:{lte:new Date()}}]},orderBy:{createdAt:"asc"}});if(!task)break;
      const token=randomUUID();
      const claimed=await db.officialAudioTask.updateMany({where:{id:task.id,status:task.status,leaseToken:task.leaseToken},data:{status:"RUNNING",leaseToken:token,leaseUntil:new Date(Date.now()+300000),attempts:{increment:1}}});if(!claimed.count)continue;
      const timer=setInterval(()=>{void db.officialAudioTask.updateMany({where:{id:task.id,leaseToken:token,status:"RUNNING"},data:{leaseUntil:new Date(Date.now()+300000)}}).catch(()=>abort.abort());},10000);
      try {await perform(task,token,abort.signal,db,network,catalogue);}
      catch(error){await db.officialAudioTask.updateMany({where:{id:task.id,leaseToken:token,status:"RUNNING"},data:error instanceof ContentImportBusyError?{status:"QUEUED",errorCode:null,leaseUntil:new Date(Date.now()+60000)}:{status:"FAILED",errorCode:officialErrorCode(error),leaseUntil:null}}).catch(()=>{});}
      finally{clearInterval(timer);}
    }
  } finally {abort.abort();await owner.end().catch(()=>{});}
}
export async function officialOverview(db: PrismaClient = prisma) {
  const tasks=await db.officialAudioTask.findMany(), approved=await hasApprovedPilot(db);
  const collections=await db.contentCollection.findMany({where:{work:{in:["bofm","dc-testament","pgp"]}},select:{id:true,work:true,editionKey:true,language:true}});
  const chapters=await db.chapter.findMany({where:{book:{contentCollection:{work:{in:["bofm","dc-testament","pgp"]}}}},select:{number:true,book:{select:{key:true,contentCollectionId:true}}}});
  const textTargets=new Set(chapters.map((c)=>JSON.stringify([c.book.contentCollectionId,c.book.key,c.number])));
  const records=await db.audioRecording.findMany({
    where:{sourceKind:"OFFICIAL"},
    select:{id:true,sourceHash:true,sha256:true,sourceMetadata:true,voice:true,quality:true,segments:true,duration:true,
      chapter:{select:{id:true,number:true,book:{select:{key:true,contentCollection:{select:{work:true,editionKey:true,language:true}}}}}},
      publication:{select:{version:true}},
    },
  });
  const found=new Map(records.flatMap((r)=>{
    if(!r.chapter)return [];
    const c=r.chapter.book.contentCollection;
    const segments=Array.isArray(r.segments)?r.segments as {start?:number}[]:[];
    const alignmentHash=objectHash({quality:(r.quality as {status?:string}).status??"",starts:segments.map(s=>s.start),duration:r.duration});
    return [[objectHash({work:c.work,editionKey:c.editionKey,language:c.language,bookKey:r.chapter.book.key,chapterNumber:r.chapter.number,voice:(r.voice as {name?:string}).name,url:(r.sourceMetadata as {url?:string}).url,sha256:r.sha256,sourceHash:r.sourceHash,alignmentHash}),r] as const];
  }));
  let root:string|undefined,freeBytes:number|null=null;
  try{root=await audioRoot();const space=await fs.statfs(root);freeBytes=space.bavail*space.bsize;}catch{}
  const publications=await db.audioPublication.findMany({select:{targetKey:true,version:true}});
  const present=async(file:string,size:number)=>{try{const stat=await fs.lstat(file);return stat.isFile()&&stat.size===size;}catch{return false;}};
  const rows=await Promise.all(officialSources.map(async(s)=>{
    const task=tasks.find((t)=>t.id===s.id),recording=found.get(s.id);
    const local=!!root && await present(path.join(root,"objects",s.sha256+".mp3"),s.bytes);
    const cachePresent=!!root && await present(path.join(root,"official-cache",s.id,"audio.mp3"),s.bytes);
    const collection=collections.find((c)=>c.work===s.work&&c.editionKey===s.editionKey&&c.language===s.language);
    const textPresent=!!collection&&textTargets.has(JSON.stringify([collection.id,s.bookKey,s.chapterNumber]));
    let blockReason: string|null=!root?"STORAGE_UNAVAILABLE":!textPresent?"TARGET_MISSING":null;
    if(s.pilot&&!blockReason)try{await target(s,db);}catch(error){blockReason=officialErrorCode(error);}
    return {id:s.id,work:s.work,language:s.language,bookKey:s.bookKey,chapterNumber:s.chapterNumber,voice:s.voice,bytes:s.bytes,pilot:s.pilot,protected:s.legacyProtected,review:s.quality!=="VALIDATED",editionPresent:!!collection,textPresent,tracked:!!task,status:task?.status??(recording?"REGISTERED":"NOT_CHECKED"),phase:task?.phase??null,waiting:task?.status==="QUEUED"&&!!task.leaseUntil&&task.leaseUntil>new Date(),recovering:task?.status==="RUNNING"&&!!task.leaseUntil&&task.leaseUntil<=new Date(),bytesDownloaded:task?.bytesDownloaded??0,errorCode:task?.errorCode??null,checkedAt:task?.checkedAt?.toISOString()??null,recordingId:recording?.id??null,published:!!recording?.publication,pointerVersion:publications.find((p)=>p.targetKey===`chapter:${recording?.chapter?.id}`)?.version??0,local,cachePresent,blockReason,attempts:task?.attempts??0};
  }));
  return {storageAvailable:!!root,freeBytes,pilotApproved:approved,pilot:rows.filter((r)=>r.pilot),groups:["bofm","dc-testament","pgp"].flatMap((work)=>["nl","en","de","fr","es"].map((language)=>{
    const items=rows.filter((r)=>r.work===work&&r.language===language);
    return {work,language,targets:new Set(items.map((r)=>`${r.bookKey}:${r.chapterNumber}`)).size,missingText:new Set(items.filter((r)=>!r.textPresent).map((r)=>`${r.bookKey}:${r.chapterNumber}`)).size,candidates:items.length,checked:items.filter((r)=>r.checkedAt).length,registered:items.filter((r)=>r.recordingId).length,published:items.filter((r)=>r.published).length,missing:items.filter((r)=>r.recordingId&&!r.local).length,review:items.filter((r)=>r.review).length,protected:items.filter((r)=>r.protected).length,editionPresent:items.some((r)=>r.editionPresent),downloadIds:items.filter((r)=>r.textPresent&&!r.protected&&!r.review&&(!r.recordingId||!r.local)&&!["QUEUED","RUNNING","VALIDATED"].includes(r.status)).map((r)=>r.id),registerIds:items.filter((r)=>r.textPresent&&r.status==="VALIDATED"&&r.cachePresent&&r.local&&!r.recordingId).map((r)=>r.id),resumeIds:items.filter((r)=>r.textPresent&&r.status==="FAILED").map((r)=>r.id),jobs:items.filter((r)=>r.status!=="NOT_CHECKED")};
  })),active:tasks.some((t)=>["RUNNING","QUEUED"].includes(t.status))};
}
export type OfficialOverview=Awaited<ReturnType<typeof officialOverview>>;
