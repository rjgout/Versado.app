import { getPublishedStudyLesson, decodePublishedStudyEdition } from "@/lib/studyContent/revisions";
import type { Prisma, PrismaClient, UserStudyContext } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
import { studyContextActionSchema, type StudyContextAction, type StudyContextView } from "@/lib/studyContextContract";
import { z } from "zod";
import { cfmProgrammeCollectionIds } from "@/lib/studyContent/cfmProgramme";

type Actor = { id: string; isAdmin: boolean };
type DB = Pick<Prisma.TransactionClient, "contentWork" | "userStudyContext" | "fsyLesson" | "user" | "studyLessonEdition">;

export class StudyContextError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INVALID_ACTION" | "CONFLICT", readonly context?: StudyContextView) {
    super(code);
  }
}

// Alleen de bestaande FSY-bloktypen; geen scraper, import of nieuw leesmodel.
const publishedBlocks = z.array(z.union([
  z.object({ type: z.enum(["heading", "paragraph", "list-item", "quote"]), text: z.string().trim().min(1) }),
  z.object({ type: z.literal("image"), url: z.string().min(1) }),
])).min(1);

export function isLegacyFsyPublished(value: string | null) {
  try { return value !== null && publishedBlocks.safeParse(JSON.parse(value)).success; } catch { return false; }
}

async function requireProgram(db: DB, workKey: string) {
  const work = await db.contentWork.findUnique({ where: { key: workKey }, select: { kind: true } });
  if (work?.kind !== "STUDY_PROGRAM") throw new StudyContextError("UNAVAILABLE");
}

/** Een legacy-key is geen toegangsbewijs: werk, bron én publicatie controleren. */
async function lessonHref(db: DB, actor: Actor, workKey: string, key: string): Promise<string | null> {
  if (key.startsWith("study:") && key.length > 6) {
    // Logische leskey is taal-/editie-onafhankelijk; alleen de werkelijk gekozen
    // collectie bepaalt de concrete reader. Geen willekeurige vertaalfallback.
    const user = await db.user.findUnique({ where: { id: actor.id }, select: { activeContentCollectionId: true } });
    if (!user?.activeContentCollectionId) return null;
    // "Kom dan en volg Mij" is één programma over jaargangscollecties: een les van een andere jaargang van het programma van de
    // actieve collectie is dus ook bereikbaar. Elke collectie houdt haar eigen toegangsregel (getPublishedStudyLesson).
    for (const collectionId of new Set([user.activeContentCollectionId, ...cfmProgrammeCollectionIds({ id: user.activeContentCollectionId })])) {
      const lesson = await getPublishedStudyLesson(actor, key.slice(6), collectionId, db);
      if (lesson?.workKey === workKey) return `/study-lesson/${encodeURIComponent(lesson.lessonId)}/${encodeURIComponent(lesson.collectionId)}`;
    }
    return null;
  }
  if (workKey !== "fsy" || !key.startsWith("fsy:") || key.length <= 4) return null;
  const lesson = await db.fsyLesson.findFirst({
    where: {
      id: key.slice(4), OR: [{ publishedContent: { not: null } }, { studyLessonEditionId: { not: null } }],
      contentCollection: { ...readingAccessWhere(actor), work: workKey },
    },
    select: { id: true, publishedContent: true, studyLessonEdition: { include: { lesson: true, collection: true, publishedRevision: true } } },
  });
  if (!lesson) return null;
  if (lesson.studyLessonEdition) {
    if (lesson.studyLessonEdition.lesson.retiredAt || !decodePublishedStudyEdition(lesson.studyLessonEdition)) return null;
    return `/fsy/${encodeURIComponent(lesson.id)}`;
  }
  if (!lesson.publishedContent) return null;
  if (!isLegacyFsyPublished(lesson.publishedContent)) return null;
  return `/fsy/${encodeURIComponent(lesson.id)}`;
}

async function view(db: DB, actor: Actor, workKey: string, row: UserStudyContext | null): Promise<StudyContextView> {
  const href = row?.activeLessonKey ? await lessonHref(db, actor, workKey, row.activeLessonKey) : null;
  return {
    workKey, activeLessonKey: row?.activeLessonKey ?? null, version: row?.version ?? 0,
    updatedAt: row?.updatedAt.toISOString() ?? null, available: href !== null, lessonHref: href,
  };
}

/** Ontbrekende of ingetrokken keuzes blijven geldige, uitsluitend lezende toestanden. */
export async function getStudyContext(actor: Actor, workKey: string, db: DB = prisma): Promise<StudyContextView> {
  await requireProgram(db, workKey);
  return view(db, actor, workKey, await db.userStudyContext.findUnique({ where: { userId_workKey: { userId: actor.id, workKey } } }));
}

/** Additieve voorbereiding voor /content: alleen bestaande eigen keuzes, nooit backfill. */
export async function getStudyContexts(actor: Actor, db: DB = prisma): Promise<StudyContextView[]> {
  const rows = await db.userStudyContext.findMany({ where: { userId: actor.id, work: { kind: "STUDY_PROGRAM" } }, orderBy: { workKey: "asc" } });
  return Promise.all(rows.map(row => view(db, actor, row.workKey, row)));
}

export async function setStudyContext(actor: Actor, input: StudyContextAction, client: PrismaClient = prisma) {
  const parsed = studyContextActionSchema.safeParse(input);
  if (!parsed.success) throw new StudyContextError("INVALID_ACTION");
  const action = parsed.data;
  const result = await client.$transaction(async db => {
    // Eén lock per gebruiker+werk, ook vóór de eerste rij bestaat. Geen locks
    // op User/economietabellen en geen tweede lockvolgorde naast beloningsflows.
    await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, action.workKey])}, 0))`;
    await requireProgram(db, action.workKey);
    const where = { userId_workKey: { userId: actor.id, workKey: action.workKey } };
    const current = await db.userStudyContext.findUnique({ where });
    if (current?.lastActionId === action.actionId) {
      if (current.activeLessonKey !== action.activeLessonKey) throw new StudyContextError("INVALID_ACTION");
      return { changed: false, context: await view(db, actor, action.workKey, current) };
    }
    if ((current?.version ?? 0) !== action.expectedVersion) {
      throw new StudyContextError("CONFLICT", await view(db, actor, action.workKey, current));
    }
    if (action.activeLessonKey !== null && !await lessonHref(db, actor, action.workKey, action.activeLessonKey)) {
      throw new StudyContextError("UNAVAILABLE");
    }
    if ((current?.activeLessonKey ?? null) === action.activeLessonKey) {
      return { changed: false, context: await view(db, actor, action.workKey, current) };
    }
    const data = { activeLessonKey: action.activeLessonKey, lastActionId: action.actionId, version: (current?.version ?? 0) + 1 };
    const row = current
      ? await db.userStudyContext.update({ where, data })
      : await db.userStudyContext.create({ data: { userId: actor.id, workKey: action.workKey, ...data } });
    return { changed: true, context: await view(db, actor, action.workKey, row) };
  }, { maxWait: 5_000, timeout: 10_000 });
  // Uitsluitend na geslaagde commit, alleen de eigen account-room; geen leskey in de socket.
  if (result.changed) emitToUser(actor.id, DATA_EVENT_SOCKET_NAME, { event: "studyContextChanged" });
  return result;
}
