import type { Prisma, PrismaClient, AudioRecording } from "@/generated/prisma/client";
import { chapterSourceHash, objectHash, type AudioManifest } from "./contract";
import { officialSource, officialSources, pilotSources } from "./officialCatalogue";
import { audioRoot,safeDirectory } from "./storage";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function lockOfficialPolicy(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(726540108)::text`;
}
export async function hasApprovedPilot(db: Prisma.TransactionClient | PrismaClient) {
  const tasks = await db.officialAudioTask.findMany({ where: { id: { in: pilotSources.map((s) => s.id) } } });
  if (tasks.length !== 5 || !tasks[0].pilotApprovalKey || tasks.some((t) => t.pilotApprovalKey !== tasks[0].pilotApprovalKey || !t.recordingId || t.status !== "REGISTERED")) return false;
  if(await db.audioPublication.count({ where: { recordingId: { in: tasks.map((t) => t.recordingId!) } } }) !== 5)return false;
  const recordings=await db.audioRecording.findMany({where:{id:{in:tasks.map((t)=>t.recordingId!)}},include:{chapter:{include:{verses:{orderBy:{number:"asc"}}}}}});
  try{
    const objects=await safeDirectory(await audioRoot(),"objects");
    for(const recording of recordings){if(!/^[a-f0-9]{64}$/.test(recording.sha256))return false;const stat=await fs.lstat(path.join(objects,recording.sha256+".mp3"));if(!stat.isFile()||stat.size!==recording.byteSize)return false;}
  }catch{return false;}
  return tasks.every((task)=>{
    const recording=recordings.find((r)=>r.id===task.recordingId),source=officialSource(task.id);
    return !!recording?.chapter&&!!source&&recording.sourceHash===source.sourceHash&&chapterSourceHash(recording.chapter)===source.sourceHash;
  });
}
export async function assertOfficialPublication(tx: Prisma.TransactionClient, candidate: AudioRecording) {
  // Zelfde lock vóór iedere pointerwissel, ook als een gegenereerde opname een pilot zou vervangen.
  await lockOfficialPolicy(tx);
  if (candidate.sourceKind !== "OFFICIAL") return;
  const task = await tx.officialAudioTask.findFirst({where:{recordingId:candidate.id}});
  const source = (task?officialSource(task.id):undefined)??officialSources.find((s) => s.sha256 === candidate.sha256 && s.sourceHash === candidate.sourceHash && s.url === (candidate.sourceMetadata as {url?:string}).url && s.voice === (candidate.voice as {name?:string}).name);
  if (!source) return; // Bestaande andere importcontracten behouden hun eigen validaties.
  if (source.legacyProtected || source.quality !== "VALIDATED") throw Error("SOURCE_PROTECTED");
  if (!source.pilot && !await hasApprovedPilot(tx)) throw Error("PILOT_REQUIRED");
}

export async function lockAudioAdmin(tx: Prisma.TransactionClient, actor: { id: string; sessionVersion: number }) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actor.id } });
  if (!user?.isAdmin || user.sessionVersion !== actor.sessionVersion) throw Error("FORBIDDEN");
}
/** Ook de bestaande scanner moet de expliciete registratiegoedkeuring respecteren. */
export async function assertOfficialRegistration(tx: Prisma.TransactionClient, manifest: AudioManifest) {
  if (!manifest.packageId.startsWith("admin-official-")) return;
  const id = manifest.packageId.slice("admin-official-".length), source = officialSource(id);
  const before = await tx.officialAudioTask.findUnique({ where: { id } });
  if (!source || !before) throw Error("REGISTRATION_NOT_APPROVED");
  await lockAudioAdmin(tx, { id: before.actorId, sessionVersion: before.actorSessionVersion });
  await lockOfficialPolicy(tx);
  await tx.$queryRaw`SELECT "id" FROM "OfficialAudioTask" WHERE "id" = ${id} FOR UPDATE`;
  const task = await tx.officialAudioTask.findUniqueOrThrow({ where: { id } });
  if (task.actorId !== before.actorId || task.actorSessionVersion !== before.actorSessionVersion || !["QUEUED","RUNNING"].includes(task.status) || task.phase !== "REGISTER" || !task.registrationApprovedAt || !task.manifest || objectHash(task.manifest) !== objectHash(manifest) || source.legacyProtected || source.quality !== "VALIDATED") throw Error("REGISTRATION_NOT_APPROVED");
  if (!source.pilot && !await hasApprovedPilot(tx)) throw Error("PILOT_REQUIRED");
}
