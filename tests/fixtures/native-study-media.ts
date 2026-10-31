import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { createStudyImport, executeStudyImport } from "../../src/lib/studyContent/imports";
import { publishStudyRevision } from "../../src/lib/studyContent/publication";
import { getTodayProgram } from "../../src/lib/todayProgram.server";
/** Alleen bestaande synthetische import/publicatie in de expliciet geïsoleerde
 * runner. Geen officiële downloads, skips, authenticatiemocks of productiedata. */
export async function seedNativeStudyMedia() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_content_access_test" || process.env.STUDY_PUBLICATION_PROFILE !== "synthetic-test") throw Error("Eigen synthetische database vereist");
  const key = `synthetic-study-cfm-native-${randomUUID()}`;
  const admin = await prisma.user.create({data:{email:`${randomUUID()}@example.invalid`,handle:`Media${randomUUID().slice(0,6)}`,discriminator:"01",passwordHash:"synthetic",isAdmin:true}});
  await prisma.contentWork.create({data:{key,kind:"STUDY_PROGRAM"}});
  await prisma.contentCollection.create({data:{id:key,slug:key,name:"Synthetisch studieprogramma",work:key,editionKey:"fixture-v1",language:"nl",icon:"",enabled:true,visibleToUsers:true,publicationState:"PUBLISHED"}});
  const actor={id:admin.id,isAdmin:true},run=await createStudyImport(actor,key,"cfm-personal");await executeStudyImport(actor,run.id);
  const items=await prisma.contentImportItem.findMany({where:{runId:run.id},include:{edition:true}});
  for(const item of items)await publishStudyRevision(actor,{editionId:item.lessonEditionId,revisionId:item.revisionId,importRunId:run.id,expectedVersion:item.edition.publicationVersion,actionId:randomUUID(),kind:"PUBLISH"});
  return {key,items,async attach(userId:string){
    await prisma.user.update({where:{id:userId},data:{activeContentCollectionId:key,contentLanguage:"nl",personalStudyMode:"STEPS"}});
    const program=await getTodayProgram({id:userId,isAdmin:false});
    if(program?.body.kind!=="cfm"||!program.body.props.week?.imageMediaId)throw Error("Echte gepubliceerde Vandaag-kaart met afbeelding ontbreekt");
    const mediaId=program.body.props.week.imageMediaId;
    return {program,mediaId,media:await prisma.contentMedia.findUniqueOrThrow({where:{id:mediaId}})};
  }};
}
