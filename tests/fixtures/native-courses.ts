import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/auth";
import { contentKeyOf } from "../../src/lib/learning/contentProgress";
export async function seedNativeCourses(language = "nl") {
 const prefix=`learning-${randomUUID()}`;
 await prisma.contentWork.upsert({where:{key:"bofm"},create:{key:"bofm",kind:"SCRIPTURE"},update:{}});
 const collection=await prisma.contentCollection.create({data:{id:prefix,slug:prefix,name:`Schriften ${language}`,icon:"book",work:"bofm",language,editionKey:prefix,enabled:true,visibleToUsers:true,publicationState:"PUBLISHED"}});
 const book=await prisma.book.create({data:{slug:prefix,key:"bofm/alma",name:"Alma",order:1,contentCollectionId:collection.id}});
 const chapters: Array<Awaited<ReturnType<typeof prisma.chapter.create>>> = [];
 for(const number of [1,32])chapters.push(await prisma.chapter.create({data:{bookId:book.id,number,order:number,verses:{create:[1,2,3,4].map(n=>({number:n,text:`Synthetisch vers ${number}:${n}.`}))}}}));
 const steps=await prisma.course.create({data:{slug:prefix,name:"Stap voor stap",type:"READING_LESSONS",contentCollectionId:collection.id,lessons:{create:[{chapterId:chapters[0].id,order:1,startVerse:1,endVerse:4},{chapterId:chapters[1].id,order:2,startVerse:1,endVerse:2},{chapterId:chapters[1].id,order:3,startVerse:3,endVerse:4}]}},include:{lessons:{orderBy:{order:"asc"}}}});
 const courses=[steps];
 for(const type of ["FRONT_TO_BACK","FREE_CHOICE"] as const)courses.push(await prisma.course.create({data:{slug:`${prefix}-${type}`,name:type==="FREE_CHOICE"?"Vrije keuze":"Hoofdstuk voor hoofdstuk",type,contentCollectionId:collection.id,chapters:{create:chapters.map((c,i)=>({chapterId:c.id,order:i}))}},include:{lessons:{orderBy:{order:"asc"}}}}));
 const password="Synthetic-B3-Learning-42";
 async function account(uiLanguage = "nl") {
  const user=await prisma.user.create({data:{email:`${randomUUID()}@example.invalid`,handle:`Leren${randomUUID().slice(0,6)}`,discriminator:"01",passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collection.id,contentLanguage:language,uiLanguage,activeCourseId:steps.id,timeZone:"UTC"}});
  for(const course of courses)await prisma.userCourseProgress.create({data:{userId:user.id,courseId:course.id,subscribed:true,...(course.id===steps.id?{currentLessonId:steps.lessons[1].id,currentChapterId:chapters[1].id}:{})}});
  await prisma.contentProgress.create({data:{userId:user.id,contentKey:contentKeyOf({id:chapters[0].id,number:1,book:{key:"bofm/alma"}}),lastChapterId:chapters[0].id,readStatus:"READ",readVerse:4,readAt:new Date()}});
  return user;
 }
 return {collection,book,chapters,courses,steps,account,password};
}
