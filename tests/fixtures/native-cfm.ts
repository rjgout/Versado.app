import type { StudyLessonEdition, StudyLesson } from "../../src/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/auth";
import { CFM_VOLUMES } from "../../src/lib/studyContent/cfmVolumes";
import { ensureCfmCourses } from "../../src/lib/studyContent/cfmCourses";
import { appendStudyRevision,type StudyRevisionInput } from "../../src/lib/studyContent/revisions";
import { seedNativeStudyMedia } from "./native-study-media";
/** Alleen eigen wegwerpdatabase: synthetische, immutable fixtures onder de
 * geregistreerde jaaridentiteiten, zodat ook het aparte HTTP-proces ze herkent.
 * Geen officiële inhoud of downloads; geen productiedatabase. */
export async function seedNativeCfm() {
 const db=new URL(process.env.DATABASE_URL??"http://invalid");
 if(db.hostname!=="127.0.0.1"||db.pathname!=="/versado_content_access_test"||process.env.STUDY_PUBLICATION_PROFILE!=="synthetic-test")throw Error("Eigen testdatabase vereist");
 const priorCourses=await prisma.course.findMany({where:{contentCollectionId:{in:CFM_VOLUMES.map(v=>v.collectionId)},type:{in:["STUDY_STEPS","STUDY_FREE"]}},select:{id:true,enabled:true}});
 const priorEnabled=new Map(priorCourses.map(c=>[c.id,c.enabled]));
 const source=await seedNativeStudyMedia(),admin=await prisma.user.findFirstOrThrow({where:{isAdmin:true}}),stamp=randomUUID();
 const original=await prisma.studyRevision.findUniqueOrThrow({where:{id:source.items[0].revisionId}});
 const media=await prisma.studyRevisionMedia.findMany({where:{revisionId:original.id}});
 const day=new Date().toISOString().slice(0,10),start=new Date(`${day}T00:00:00Z`),monday=new Date(start.getTime()-((start.getUTCDay()+6)%7)*86400000);
 const shift=(n:number)=>new Date(monday.getTime()+n*86400000);
 await prisma.studyLesson.updateMany({where:{workKey:{in:CFM_VOLUMES.map(v=>v.workKey)},sourceKey:{startsWith:"b3a2-fixture-"}},data:{retiredAt:new Date()}});
 const editions:Array<StudyLessonEdition & {revisionId:string;lesson:StudyLesson}>=[];
 for(const [vi,volume]of CFM_VOLUMES.entries()) {
  await prisma.contentWork.upsert({where:{key:volume.workKey},create:{key:volume.workKey,kind:"STUDY_PROGRAM"},update:{}});
  await prisma.contentCollection.upsert({where:{id:volume.collectionId},create:{id:volume.collectionId,slug:volume.collectionSlug,name:`CFM ${volume.year}`,work:volume.workKey,editionKey:volume.editionKey,language:"nl",icon:"book",enabled:true,visibleToUsers:true,publicationState:"PUBLISHED"},update:{enabled:true,visibleToUsers:true,publicationState:"PUBLISHED"}});
  const period=await prisma.studyPeriod.create({data:{workKey:volume.workKey,sourceKey:stamp,label:`Synthetische ${volume.year}`,year:volume.year}});
  for(const [i,offset]of (vi===0?[0,-7,-140]:[70]).entries()) {
   const lesson=await prisma.studyLesson.create({data:{workKey:volume.workKey,periodId:period.id,sourceKey:`b3a2-fixture-${stamp}-${i}`,order:i,startsOn:shift(offset),endsOnExclusive:shift(offset+7)}});
   const edition=await prisma.studyLessonEdition.create({data:{lessonId:lesson.id,collectionId:volume.collectionId,workKey:volume.workKey,slug:`b3a2-${stamp}-${i}`}});
   const revision=await appendStudyRevision(admin,edition.id,{schemaVersion:1,title:`Synthetische week ${volume.year} ${i+1}`,body:original.body as unknown as StudyRevisionInput["body"],sourceMetadata:original.sourceMetadata as unknown as StudyRevisionInput["sourceMetadata"],rightsMetadata:original.rightsMetadata as unknown as StudyRevisionInput["rightsMetadata"]});
   await prisma.studyRevisionMedia.createMany({data:media.map(m=>({revisionId:revision.id,mediaKey:m.mediaKey,mediaId:m.mediaId}))});
   await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:revision.id,publicationVersion:1}});
   editions.push({...edition,revisionId:revision.id,lesson});
  }
  await ensureCfmCourses(prisma,{id:volume.collectionId,slug:volume.collectionSlug});
 }
 const key=CFM_VOLUMES[0].collectionId,courses=await prisma.course.findMany({where:{contentCollectionId:key,type:{in:["STUDY_STEPS","STUDY_FREE"]}}});
 await prisma.course.updateMany({where:{id:{in:courses.map(c=>c.id)}},data:{enabled:true}});
 const steps=courses.find(c=>c.type==="STUDY_STEPS")!,free=courses.find(c=>c.type==="STUDY_FREE")!,password="Synthetic-Native-CFM-42";
 async function account(language="nl") {
  const user=await prisma.user.create({data:{email:`${randomUUID()}@example.invalid`,handle:`CFM${randomUUID().slice(0,6)}`,discriminator:"01",passwordHash:await hashPassword(password),isAdmin:false,emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:key,contentLanguage:"nl",uiLanguage:language,timeZone:"UTC",personalStudyMode:"STEPS",activeCourseId:steps.id}});
  for(const course of courses)await prisma.userCourseProgress.create({data:{userId:user.id,courseId:course.id,subscribed:true}});
  return user;
 }
 return {key,steps,free,courses,editions,account,password,foreignEditionId:source.items[0].lessonEditionId,cleanup:async()=>{
  await prisma.contentCollection.updateMany({where:{id:{in:[source.key,...CFM_VOLUMES.map(v=>v.collectionId)]}},data:{enabled:false}});
  await prisma.studyLesson.updateMany({where:{id:{in:editions.map(e=>e.lessonId)}},data:{retiredAt:new Date()}});
  // Alleen de fixture activeert deze cursussen; herstel de vorige beschikbaarheid.
  for(const course of courses)await prisma.course.update({where:{id:course.id},data:{enabled:priorEnabled.get(course.id)??false}});
 }};
}
