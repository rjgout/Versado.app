// Alleen synthetische hoofdstukken/oefeningen op de wegwerpdatabase; geen seed/import.
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/db.ts';
import { splitVerseRange } from '../../src/lib/learning/exercisePlan.ts';
const url=new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL??'http://invalid');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/versado_content_access_test')throw new Error('Eigen runner vereist');
try {
 for(const collection of ['content_bom','content_bom_en']) {
  const course=await prisma.course.create({data:{slug:`mystery-learning-${randomUUID()}`,name:'Synthetische leesstappen',type:'READING_LESSONS',contentCollectionId:collection}});
  let order=0;
  for(const [key,numbers] of [['bofm/1-ne',[3,4,6,7,8]],['bofm/alma',[5,6,7,8,9,10,32]],['mystery/reading-only',[1]]]) {
   let book=await prisma.book.findFirst({where:{key,contentCollectionId:collection}});
   book??=await prisma.book.create({data:{slug:`mystery-learning-${randomUUID()}`,key,name:'Synthetisch studieboek',order:1,contentCollectionId:collection}});
   for(const number of numbers) {
    let chapter=await prisma.chapter.findFirst({where:{bookId:book.id,number}});
    chapter??=await prisma.chapter.create({data:{bookId:book.id,number,order:number}});
    const readingOnly=key==='mystery/reading-only';const length=readingOnly?5:30;
    for(let n=1;n<=length;n++) {
     const verse=await prisma.verse.upsert({where:{chapterId_number:{chapterId:chapter.id,number:n}},create:{chapterId:chapter.id,number:n,text:`Synthetisch vers ${n} met gecontroleerde oefenwoorden.`},update:{}});
     if(!readingOnly)for(let i=0;i<2;i++)await prisma.exercise.create({data:{chapterId:chapter.id,sourceVerseId:verse.id,order:n*2+i,type:'TRUE_FALSE',status:'APPROVED',verseRef:`Synthetisch ${number}:${n}`,prompt:`Synthetische stelling ${n}/${i}`,answers:'["true"]'}});
    }
    await prisma.courseChapter.create({data:{courseId:course.id,chapterId:chapter.id,order:++order}});
    for(const part of splitVerseRange(length))await prisma.courseLesson.create({data:{courseId:course.id,chapterId:chapter.id,order:++order,...part}});
   }
  }
 }
 console.log('Synthetische lees-, oefen- en XP-regressiefixture gereed; geen productiecontent gebruikt.');
}finally{await prisma.$disconnect();}
