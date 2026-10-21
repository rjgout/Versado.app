import { prisma } from "@/lib/db";
import { getStudyContext, isLegacyFsyPublished } from "@/lib/studyContext";
import { userDayKey } from "@/lib/timeZone";
import { canAccessCollection } from "@/lib/contentAccess";
import { readingAccessWhere } from "@/lib/contentAccess";
import { isPersonalStudyWork } from "./personalStudyOverrides";
import { completedStepCounts } from "./stepProgress";
import { calendarWeekOf } from "./weekSelection";

/**
 * De officiële afbeelding bij een les: de eerste figuur van minimaal 300 px breed in de bron (de omslagafbeelding), met de
 * bijbehorende, gebruiksklare media. Eén SQL-pad over het JSON-document, zodat de lijst nooit 52 hele lessen laadt.
 */
async function lessonImageMedia(revisionIds: string[]): Promise<Map<string, string>> {
  if (!revisionIds.length) return new Map();
  const keys = await prisma.$queryRaw<Array<{ id: string; mediaKey: string | null }>>`
    SELECT r.id, jsonb_path_query_first(r.body::jsonb, '$.sections[*].blocks[*] ? (@.type == "figure" && @.width >= 300).mediaKey') #>> '{}' AS "mediaKey"
    FROM "StudyRevision" r WHERE r.id = ANY(${revisionIds})`;
  const wanted = keys.filter(k => k.mediaKey);
  if (!wanted.length) return new Map();
  const bindings = await prisma.studyRevisionMedia.findMany({
    where: { OR: wanted.map(k => ({ revisionId: k.id, mediaKey: k.mediaKey! })), media: { status: "READY" } },
    select: { revisionId: true, mediaId: true },
  });
  return new Map(bindings.map(b => [b.revisionId, b.mediaId]));
}

/**
 * Wanneer is er voor het laatst echt gestudeerd, per leseditie? Alleen bestaande, betrouwbare tijdstempels: `openedAt` van een stap
 * (wordt bij elke heropening bijgewerkt) en `completedAt`, `ReadingPosition.updatedAt` (alleen geschreven bij echt lezen) en
 * `ContentProgress.readAt` (bewuste leesmarkering). Een week kiezen of het weekpad bekijken schrijft hier niets. Geen tijdstip =
 * null; er wordt nooit een tijdstip verzonnen.
 */
async function lastStudiedByEdition(
  userId: string,
  editions: Array<{ id: string; contentKey: string }>,
  progress: Array<{ contentKey: string; readAt: Date | null }>,
): Promise<Map<string, string>> {
  const result = new Map<string, number>();
  const bump = (id: string, at: Date | null | undefined) => {
    if (at && (result.get(id) ?? 0) < at.getTime()) result.set(id, at.getTime());
  };
  if (!editions.length) return new Map();
  const ids = editions.map((e) => e.id);
  const [steps, positions] = await Promise.all([
    prisma.studyStepProgress.groupBy({ by: ["lessonEditionId"], where: { userId, lessonEditionId: { in: ids } }, _max: { openedAt: true, completedAt: true } }),
    prisma.readingPosition.findMany({ where: { userId, lessonEditionId: { in: ids } }, select: { lessonEditionId: true, updatedAt: true } }),
  ]);
  for (const row of steps) { bump(row.lessonEditionId, row._max.openedAt); bump(row.lessonEditionId, row._max.completedAt); }
  for (const row of positions) bump(row.lessonEditionId, row.updatedAt);
  const byKey = new Map(editions.map((e) => [e.contentKey, e.id]));
  for (const row of progress) { const id = byKey.get(row.contentKey); if (id) bump(id, row.readAt); }
  return new Map([...result].map(([id, at]) => [id, new Date(at).toISOString()]));
}

/** Normale leslijst onder Leren; geen cursussen aanmaken of voorkeuren wijzigen. */
export async function getStudyCatalogue(actor: {
  id: string;
  isAdmin: boolean;
}, now = new Date(), options: { collectionId?: string } = {}) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { activeContentCollectionId: true, timeZone: true, personalStudyMode: true, activeContentCollection: { include: { contentWork: { select: { kind: true } } } } },
  });
  // Een cursus (CFM) leest altijd uit de collectie van die cursus, niet uit de toevallig actieve collectie van de gebruiker;
  // de actieve collectie verandert hierdoor nooit. Zonder collectionId blijft het de actieve collectie (Leren-overzicht).
  const scoped = options.collectionId && options.collectionId !== user?.activeContentCollectionId
    ? await prisma.contentCollection.findUnique({ where: { id: options.collectionId }, include: { contentWork: { select: { kind: true } } } })
    : null;
  const collection = options.collectionId ? (scoped ?? (options.collectionId === user?.activeContentCollectionId ? user.activeContentCollection : null)) : user?.activeContentCollection ?? null;
  if (!user || !collection || !canAccessCollection(actor, collection) || collection.contentWork?.kind !== "STUDY_PROGRAM")
    return { personalMode: null as "FREE"|"STEPS"|null, lessons: [], context: null, programName: null, collectionId: null, currentLessonKey: null, today: null as string|null, truncated: false, token: String(Date.now()) };
  const collectionId = collection.id;
  const lessons = await prisma.studyLessonEdition.findMany({
    where: {
      collectionId,
      collection: readingAccessWhere(actor),
      publishedRevisionId: { not: null },
      lesson: { retiredAt: null, work: { kind: "STUDY_PROGRAM" } },
    },
    orderBy: [{ lesson: { period: { year: "asc" } } }, { lesson: { month: "asc" } }, { lesson: { order: "asc" } }, { id: "asc" }],
    select: { id:true, lessonId:true, collectionId:true, workKey:true, publishedRevisionId:true, publishedRevision:{select:{title:true}}, legacyFsyLesson:{select:{id:true}}, lesson:{include:{period:true}} },
    take: 201,
  });
  const workKey = collection.work;
  const context = workKey ? await getStudyContext(actor, workKey) : null;
  const safe = lessons.slice(0,200);
  const progress = await prisma.contentProgress.findMany({where:{userId:actor.id,contentKey:{in:safe.map(e=>`study:${e.workKey}:${e.lesson.periodId}:${e.lesson.sourceKey}`)}},select:{contentKey:true,readStatus:true,readAt:true}});
  const images = await lessonImageMedia(safe.map(e=>e.publishedRevisionId!));
  const lastStudied = await lastStudiedByEdition(actor.id, safe.map(e=>({id:e.id,contentKey:`study:${e.workKey}:${e.lesson.periodId}:${e.lesson.sourceKey}`})),progress);
  const stepCounts = await completedStepCounts(actor, safe.map(e=>({editionId:e.id,revisionId:e.publishedRevisionId!})));
  const result = safe.map(e=>({ id:e.id,lessonId:e.lessonId,collectionId:e.collectionId,title:e.publishedRevision!.title,lessonKey:`study:${e.lessonId}`,workKey:e.workKey,
    order:e.lesson.order,revisionId:e.publishedRevisionId!, legacyKey:e.legacyFsyLesson ? `fsy:${e.legacyFsyLesson.id}` : null,year:e.lesson.period.year,month:e.lesson.month,category:e.lesson.categoryKey,
    startsOn:e.lesson.startsOn?.toISOString().slice(0,10)??null,endsOnExclusive:e.lesson.endsOnExclusive?.toISOString().slice(0,10)??null,
    read:progress.some(p=>p.contentKey===`study:${e.workKey}:${e.lesson.periodId}:${e.lesson.sourceKey}`&&p.readStatus==="READ"),
    // Persoonlijke studie 2.0: alleen "Kom dan en volg Mij"-lessen hebben een zeven-stappenroute.
    personal:isPersonalStudyWork(e.workKey), stepsDone:stepCounts.get(e.id)??0,
    // Recentste echte studieactiviteit (stap geopend/afgerond, leespositie bewaard, bewust gelezen); null zonder betrouwbaar tijdstip.
    lastStudiedAt:lastStudied.get(e.id)??null as string|null,
    // Officiële lesafbeelding (eerste inhoudelijke figuur van de bron); null als de les er geen heeft.
    imageMediaId:images.get(e.publishedRevisionId!)??null }));
  if(workKey === "fsy") {
    const legacy=await prisma.fsyLesson.findMany({where:{contentCollectionId:collectionId,studyLessonEditionId:null,publishedContent:{not:null}},orderBy:[{year:"asc"},{month:"asc"},{order:"asc"},{id:"asc"}],take:201});
    for(const l of legacy.filter(l=>isLegacyFsyPublished(l.publishedContent))) result.push({id:l.id,lessonId:l.id,collectionId:l.contentCollectionId,title:l.publishedTitle??l.title,lessonKey:`fsy:${l.id}`,workKey:"fsy",order:l.order,revisionId:"",legacyKey:`fsy:${l.id}`,year:l.year,month:l.month,category:l.category,startsOn:null,endsOnExclusive:null,read:false,personal:false,stepsDone:0,lastStudiedAt:null as string|null,imageMediaId:null as string|null});
  }
  result.sort((a,b)=>(a.year??0)-(b.year??0)||(a.month??0)-(b.month??0)||a.order-b.order||a.id.localeCompare(b.id));
  const truncated=lessons.length>200||result.length>200;
  const bounded=result.slice(0,200);
  const today=userDayKey(user,now);
  // Dezelfde kalenderweekregel als de weekselectie (weekSelection.ts): eenduidig of geen.
  const current=calendarWeekOf(bounded.filter(l=>l.personal),today)??calendarWeekOf(bounded.filter(l=>!l.personal),today);
  return { personalMode: user.personalStudyMode, lessons: bounded, context, programName:collection.name, collectionId, currentLessonKey:current?.lessonKey ?? null, today:today as string|null, truncated, token: String(Date.now()) };
}
