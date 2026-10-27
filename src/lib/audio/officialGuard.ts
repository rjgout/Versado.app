import type { Prisma, AudioRecording } from "@/generated/prisma/client";
import { objectHash, type AudioManifest } from "./contract";
import { officialSource, officialSources } from "./officialCatalogue";
export async function lockOfficialPolicy(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(726540108)::text`;
}
export async function assertOfficialPublication(tx: Prisma.TransactionClient, candidate: AudioRecording) {
  // Zelfde lock vóór iedere pointerwissel, om bronbeveiliging en expliciete registratiebesluiten te serialiseren.
  await lockOfficialPolicy(tx);
  const chapter=candidate.chapterId?await tx.chapter.findUnique({where:{id:candidate.chapterId},include:{book:{include:{contentCollection:true}}}}):null;
  const known=chapter?officialSources.filter(s=>s.work===chapter.book.contentCollection.work&&s.editionKey===chapter.book.contentCollection.editionKey&&s.language===chapter.book.contentCollection.language&&s.bookKey===chapter.book.key&&s.chapterNumber===chapter.number):[];
  if(known.some(s=>s.legacyProtected))throw Error("SOURCE_PROTECTED");
  if (candidate.sourceKind !== "OFFICIAL") return;
  if(known.some(s=>s.quality!=="VALIDATED"&&(s.voice===(candidate.voice as {name?:string}).name||(s.sha256===candidate.sha256&&s.sourceHash===candidate.sourceHash))))throw Error("SOURCE_PROTECTED");
  const task = await tx.officialAudioTask.findFirst({where:{recordingId:candidate.id}});
  const source = (task?officialSource(task.id):undefined)??officialSources.find((s) => s.sha256 === candidate.sha256 && s.sourceHash === candidate.sourceHash && s.url === (candidate.sourceMetadata as {url?:string}).url && s.voice === (candidate.voice as {name?:string}).name);
  if (!source) {
    return; // Bestaande andere importcontracten behouden hun eigen validaties.
  }
  if (source.legacyProtected || source.quality !== "VALIDATED") throw Error("SOURCE_PROTECTED");
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
}
