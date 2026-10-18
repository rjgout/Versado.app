import { prisma } from "@/lib/db";
import { getStudyContext, isLegacyFsyPublished } from "@/lib/studyContext";
import { userDayKey } from "@/lib/timeZone";
import { canAccessCollection } from "@/lib/contentAccess";
import { readingAccessWhere } from "@/lib/contentAccess";

/** Normale leslijst onder Leren; geen cursussen aanmaken of voorkeuren wijzigen. */
export async function getStudyCatalogue(actor: {
  id: string;
  isAdmin: boolean;
}, now = new Date()) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { activeContentCollectionId: true, timeZone: true, activeContentCollection: { include: { contentWork: { select: { kind: true } } } } },
  });
  if (!user?.activeContentCollectionId || !canAccessCollection(actor,user.activeContentCollection) || user.activeContentCollection?.contentWork?.kind !== "STUDY_PROGRAM")
    return { lessons: [], context: null, programName: null, currentLessonKey: null, truncated: false, token: String(Date.now()) };
  const lessons = await prisma.studyLessonEdition.findMany({
    where: {
      collectionId: user.activeContentCollectionId,
      collection: readingAccessWhere(actor),
      publishedRevisionId: { not: null },
      lesson: { retiredAt: null, work: { kind: "STUDY_PROGRAM" } },
    },
    orderBy: [{ lesson: { period: { year: "asc" } } }, { lesson: { month: "asc" } }, { lesson: { order: "asc" } }, { id: "asc" }],
    select: { id:true, lessonId:true, collectionId:true, workKey:true, publishedRevisionId:true, publishedRevision:{select:{title:true}}, legacyFsyLesson:{select:{id:true}}, lesson:{include:{period:true}} },
    take: 201,
  });
  const workKey = user.activeContentCollection?.contentWork?.kind === "STUDY_PROGRAM" ? user.activeContentCollection.work : null;
  const context = workKey ? await getStudyContext(actor, workKey) : null;
  const safe = lessons.slice(0,200);
  const progress = await prisma.contentProgress.findMany({where:{userId:actor.id,contentKey:{in:safe.map(e=>`study:${e.workKey}:${e.lesson.periodId}:${e.lesson.sourceKey}`)}},select:{contentKey:true,readStatus:true}});
  const result = safe.map(e=>({ id:e.id,lessonId:e.lessonId,collectionId:e.collectionId,title:e.publishedRevision!.title,lessonKey:`study:${e.lessonId}`,workKey:e.workKey,
    order:e.lesson.order,revisionId:e.publishedRevisionId!, legacyKey:e.legacyFsyLesson ? `fsy:${e.legacyFsyLesson.id}` : null,year:e.lesson.period.year,month:e.lesson.month,category:e.lesson.categoryKey,
    startsOn:e.lesson.startsOn?.toISOString().slice(0,10)??null,endsOnExclusive:e.lesson.endsOnExclusive?.toISOString().slice(0,10)??null,
    read:progress.some(p=>p.contentKey===`study:${e.workKey}:${e.lesson.periodId}:${e.lesson.sourceKey}`&&p.readStatus==="READ") }));
  if(workKey === "fsy") {
    const legacy=await prisma.fsyLesson.findMany({where:{contentCollectionId:user.activeContentCollectionId,studyLessonEditionId:null,publishedContent:{not:null}},orderBy:[{year:"asc"},{month:"asc"},{order:"asc"},{id:"asc"}],take:201});
    for(const l of legacy.filter(l=>isLegacyFsyPublished(l.publishedContent))) result.push({id:l.id,lessonId:l.id,collectionId:l.contentCollectionId,title:l.publishedTitle??l.title,lessonKey:`fsy:${l.id}`,workKey:"fsy",order:l.order,revisionId:"",legacyKey:`fsy:${l.id}`,year:l.year,month:l.month,category:l.category,startsOn:null,endsOnExclusive:null,read:false});
  }
  result.sort((a,b)=>(a.year??0)-(b.year??0)||(a.month??0)-(b.month??0)||a.order-b.order||a.id.localeCompare(b.id));
  const truncated=lessons.length>200||result.length>200;
  const bounded=result.slice(0,200);
  const today=userDayKey(user,now);
  const current=bounded.filter(l=>l.startsOn && l.endsOnExclusive && l.startsOn<=today && today<l.endsOnExclusive);
  return { lessons: bounded, context, programName:user.activeContentCollection.name, currentLessonKey:current.length===1 ? current[0].lessonKey : null, truncated, token: String(Date.now()) };
}
