import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type Bookmark, type Highlight, type Note } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getPublishedStudyLesson } from "@/lib/studyContent/revisions";
import { studyObjectHash } from "@/lib/studyContent/policy";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
import { annotationPutSchema, annotationDeleteSchema, annotationResolveSchema, validatePassageSelector, type AnnotationAction, type AnnotationKind, type AnnotationTarget } from "./contract";
import { placeAnnotation } from "./revisionResolution";

type Actor = { id: string; isAdmin: boolean };
type Db = Prisma.TransactionClient;
type Row = Bookmark | Highlight | Note;
export class AnnotationError extends Error {
  constructor(readonly code: "INVALID" | "UNAVAILABLE" | "CONFLICT", readonly state?: ReturnType<typeof view>) { super(code); }
}
export function annotationTargetKey(target: AnnotationTarget) {
  return target.type === "verse" ? `verse:${target.verseId}` : `lesson:${studyObjectHash({
    lessonEditionId: target.lessonEditionId, revisionId: target.revisionId,
    sectionAnchor: target.selector.sectionAnchor, ranges: target.selector.ranges,
  })}`;
}
function view(kind: AnnotationKind, row: Row, placement?: ReturnType<typeof placeAnnotation>) {
  return {
    id: row.id, kind, targetKey: row.targetKey ?? `verse:${row.verseId}`,
    target: row.verseId ? { type: "verse" as const, verseId: row.verseId }
      : { type: "lesson" as const, lessonEditionId: row.lessonEditionId!, revisionId: row.revisionId!, selector: row.selector },
    mutationVersion: row.mutationVersion, deleted: !!row.deletedAt, anchorStatus: row.anchorStatus,
    createdAt: row.createdAt.toISOString(),
    ...("text" in row ? { text: row.text, updatedAt: row.updatedAt.toISOString() } : {}),
    ...("color" in row ? { color: row.color } : {}),
    // Alleen de studielezer vraagt dit op; het oorspronkelijke responsecontract van de overige reads blijft gelijk.
    ...(placement ? { placement: placement.status === "EXACT" ? { status: placement.status, selector: placement.selector } : { status: placement.status } } : {}),
  };
}
async function find(db: Db, userId: string, kind: AnnotationKind, target: AnnotationTarget) {
  const where = { userId, ...(target.type === "verse" ? { verseId: target.verseId } : { targetKey: annotationTargetKey(target) }) };
  return kind === "bookmark" ? db.bookmark.findFirst({ where }) : kind === "highlight" ? db.highlight.findFirst({ where }) : db.note.findFirst({ where });
}
async function authorize(db: Db, actor: Actor, target: AnnotationTarget, known?: Row | null) {
  let collectionId: string | undefined;
  if (target.type === "verse") {
    collectionId = (await db.verse.findUnique({ where: { id: target.verseId }, select: { chapter: { select: { book: { select: { contentCollectionId: true } } } } } }))?.chapter.book.contentCollectionId;
  } else {
    collectionId = (await db.studyLessonEdition.findUnique({ where: { id: target.lessonEditionId }, select: { collectionId: true } }))?.collectionId;
  }
  if (!collectionId) throw new AnnotationError("UNAVAILABLE");
  // Vaste volgorde: collectie → (les) → editie/vers → eigen targetlock.
  await db.$queryRaw`SELECT id FROM "ContentCollection" WHERE id=${collectionId} FOR SHARE`;
  if (target.type === "verse") {
    await db.$queryRaw`SELECT id FROM "Verse" WHERE id=${target.verseId} FOR SHARE`;
    if (!await db.verse.findFirst({ where: { id: target.verseId, chapter: { book: { contentCollection: readingAccessWhere(actor) } } }, select: { id: true } })) throw new AnnotationError("UNAVAILABLE");
    return;
  }
  const edition = await db.studyLessonEdition.findUnique({ where: { id: target.lessonEditionId }, select: { lessonId: true } });
  if (!edition) throw new AnnotationError("UNAVAILABLE");
  await db.$queryRaw`SELECT id FROM "StudyLesson" WHERE id=${edition.lessonId} FOR SHARE`;
  await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${target.lessonEditionId} FOR SHARE`;
  const published = await getPublishedStudyLesson(actor, edition.lessonId, collectionId, db);
  // Leesbezoekbewijzen verlenen bewust geen historische annotatieschrijfrechten.
  if (!published || published.editionId !== target.lessonEditionId) throw new AnnotationError("UNAVAILABLE");
  if (published.revisionId !== target.revisionId) {
    // Een eigen, actieve annotatie met een bewezen exacte plaats in de nu gepubliceerde revisie (herplaatst of bevestigd)
    // blijft via haar oorspronkelijke identiteit beheerbaar; alles wat niet bewezen is, krijgt geen nieuwe schrijfrechten.
    if (known && !known.deletedAt && placeAnnotation(published, known).status === "EXACT") return;
    throw new AnnotationError("UNAVAILABLE");
  }
  try { validatePassageSelector(published.body, target.selector); } catch { throw new AnnotationError("INVALID"); }
}
function notify(userId: string) {
  // Uitsluitend scope/event; geen tekst, selector, target of gebruikersprofiel.
  emitToUser(userId, DATA_EVENT_SOCKET_NAME, { event: "annotationsChanged" });
}
async function write(db: Db, actor: Actor, action: AnnotationAction, remove: boolean, existing: Row | null) {
  if (existing && action.target.type === "lesson" && studyObjectHash(existing.selector) !== studyObjectHash(action.target.selector)) throw new AnnotationError("INVALID");
  const key = annotationTargetKey(action.target);
  const hash = studyObjectHash({ ...action, operation: remove ? "DELETE" : "PUT" });
  if (existing?.lastActionId === action.actionId) {
    if (existing.lastActionHash !== hash) throw new AnnotationError("INVALID");
    return { changed: false, annotation: view(action.kind, existing) };
  }
  if ((existing?.mutationVersion ?? 0) !== action.expectedVersion) throw new AnnotationError("CONFLICT", existing ? view(action.kind, existing) : undefined);
  const data = {
    targetKey: key,
    mutationVersion: (existing?.mutationVersion ?? 0) + 1,
    lastActionId: action.actionId, lastActionHash: hash,
    deletedAt: remove ? (existing?.deletedAt ?? new Date()) : null,
  };
  const target = action.target.type === "verse" ? { verseId: action.target.verseId }
    : { lessonEditionId: action.target.lessonEditionId, revisionId: action.target.revisionId, selector: action.target.selector as Prisma.InputJsonValue };
  let row: Row;
  if (action.kind === "bookmark") row = existing
    ? await db.bookmark.update({ where: { id: existing.id }, data })
    : await db.bookmark.create({ data: { ...data, ...target, userId: actor.id } });
  else if (action.kind === "highlight") row = existing
    ? await db.highlight.update({ where: { id: existing.id }, data: { ...data, ...(!remove ? { color: action.color ?? "yellow" } : {}) } })
    : await db.highlight.create({ data: { ...data, ...target, userId: actor.id, color: action.color ?? "yellow" } });
  else row = existing
    ? await db.note.update({ where: { id: existing.id }, data: { ...data, text: remove ? "" : action.text! } })
    : await db.note.create({ data: { ...data, ...target, userId: actor.id, text: remove ? "" : action.text! } });
  return { changed: true, annotation: view(action.kind, row) };
}
/** Alle nieuwe PUT/DELETE en oude verse-adapters lopen langs dezelfde write- en lockregels. */
export async function mutateAnnotation(actor: Actor, input: unknown, remove = false, client: PrismaClient = prisma) {
  const parsed = (remove ? annotationDeleteSchema : annotationPutSchema).safeParse(input);
  if (!parsed.success) throw new AnnotationError("INVALID");
  const action: AnnotationAction = parsed.data;
  // Technische rollbackstand: versadapters, eigen readback en DELETE blijven veilig.
  if (!remove && action.target.type === "lesson" && process.env.STUDY_ANNOTATION_WRITES === "0") throw new AnnotationError("UNAVAILABLE");
  const result = await client.$transaction(async db => {
    await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
    await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
    // Alleen bestaande actieve privénotities mogen zonder nieuwe broninzage worden bewerkt.
    // Nieuwe targets en heractivaties houden de lockvolgorde collectie → target.
    const known = await find(db, actor.id, action.kind, action.target);
    const privateEdit = !remove && action.kind === "note" && known && !known.deletedAt;
    if ((!remove && !privateEdit) || !known) await authorize(db, actor, action.target, known);
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, action.kind, annotationTargetKey(action.target)])},0))`;
    const existing = await find(db, actor.id, action.kind, action.target);
    // Een DELETE tijdens het wachten mag niet veranderen in een ongeautoriseerde heractivatie.
    if (privateEdit && (!existing || existing.deletedAt)) throw new AnnotationError("CONFLICT", existing ? view(action.kind, existing) : undefined);
    return write(db, actor, action, remove, existing);
  }, { timeout: 15_000 });
  if (result.changed) notify(actor.id);
  return result;
}
async function findById(db: Db, userId: string, kind: AnnotationKind, id: string): Promise<Row | null> {
  const where = { id, userId };
  return kind === "bookmark" ? db.bookmark.findFirst({ where }) : kind === "highlight" ? db.highlight.findFirst({ where }) : db.note.findFirst({ where });
}
/**
 * Fase 4D: bevestig een nieuwe locatie voor een bestaande eigen studieannotatie. Dit maakt nooit een tweede annotatie en
 * wijzigt de oorspronkelijke revisie, selector, targetKey en tekst niet: alleen de losse resolutiemetadata en de
 * mutatieversie veranderen. Dezelfde locks, versie- en actionId-regels als mutateAnnotation; een tombstone blijft een tombstone.
 */
export async function resolveAnnotation(actor: Actor, input: unknown, client: PrismaClient = prisma) {
  const parsed = annotationResolveSchema.safeParse(input);
  if (!parsed.success) throw new AnnotationError("INVALID");
  const action = parsed.data;
  const hash = studyObjectHash({ operation: "RESOLVE", kind: action.kind, id: action.id, mode: action.mode, revisionId: action.revisionId, selector: action.selector });
  if (process.env.STUDY_ANNOTATION_WRITES === "0") throw new AnnotationError("UNAVAILABLE");
  const result = await client.$transaction(async db => {
    await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
    await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
    const known = await findById(db, actor.id, action.kind, action.id);
    if (!known?.lessonEditionId || !known.targetKey) throw new AnnotationError("UNAVAILABLE");
    // Een identieke retry na een verloren respons hoeft de bron niet opnieuw te openen.
    if (known.lastActionId === action.actionId) {
      if (known.lastActionHash !== hash) throw new AnnotationError("INVALID");
      return { changed: false, annotation: view(action.kind, known) };
    }
    if (known.deletedAt) throw new AnnotationError("UNAVAILABLE");
    const edition = await db.studyLessonEdition.findUnique({ where: { id: known.lessonEditionId }, select: { lessonId: true, collectionId: true } });
    if (!edition) throw new AnnotationError("UNAVAILABLE");
    // Vaste volgorde, gelijk aan authorize: collectie → les → editie → eigen targetlock.
    await db.$queryRaw`SELECT id FROM "ContentCollection" WHERE id=${edition.collectionId} FOR SHARE`;
    await db.$queryRaw`SELECT id FROM "StudyLesson" WHERE id=${edition.lessonId} FOR SHARE`;
    await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${known.lessonEditionId} FOR SHARE`;
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, action.kind, known.targetKey])},0))`;
    const existing = await findById(db, actor.id, action.kind, action.id);
    // Een DELETE tijdens het wachten mag door een late resolutie nooit weer actief worden.
    if (!existing || existing.deletedAt) throw new AnnotationError("CONFLICT", existing ? view(action.kind, existing) : undefined);
    if (existing.lastActionId === action.actionId) {
      if (existing.lastActionHash !== hash) throw new AnnotationError("INVALID");
      return { changed: false, annotation: view(action.kind, existing) };
    }
    if (existing.mutationVersion !== action.expectedVersion) throw new AnnotationError("CONFLICT", view(action.kind, existing));
    const published = await getPublishedStudyLesson(actor, edition.lessonId, edition.collectionId, db);
    if (!published || published.editionId !== existing.lessonEditionId || published.revisionId !== action.revisionId) throw new AnnotationError("UNAVAILABLE");
    try { validatePassageSelector(published.body, action.selector); } catch { throw new AnnotationError("INVALID"); }
    const placement = placeAnnotation(published, existing);
    // Een annotatie die al bewezen op haar plaats staat, heeft geen koppeling nodig.
    if (placement.status === "EXACT") throw new AnnotationError("INVALID");
    // Een voorstel bevestigen kan alleen als de server nog steeds precies dit voorstel doet; anders is de stand veranderd.
    if (action.mode === "proposal" && (placement.status !== "NEEDS_REVIEW" || studyObjectHash(placement.proposal) !== studyObjectHash(action.selector)))
      throw new AnnotationError("CONFLICT", view(action.kind, existing));
    const data = {
      resolvedRevisionId: action.revisionId, resolvedSelector: action.selector as Prisma.InputJsonValue, resolvedAt: new Date(),
      mutationVersion: existing.mutationVersion + 1, lastActionId: action.actionId, lastActionHash: hash,
    };
    const row: Row = action.kind === "bookmark" ? await db.bookmark.update({ where: { id: existing.id }, data })
      : action.kind === "highlight" ? await db.highlight.update({ where: { id: existing.id }, data })
      // Technische metadata is geen bewerking van de notitie: updatedAt blijft zoals het was.
      : await db.note.update({ where: { id: existing.id }, data: { ...data, updatedAt: (existing as Note).updatedAt } });
    return { changed: true, annotation: view(action.kind, row) };
  }, { timeout: 15_000 });
  if (result.changed) notify(actor.id);
  return result;
}
/** Oude toggles kunnen geen retry-id aanleveren; iedere POST blijft één bewuste toggle. */
export async function legacyVerseAnnotation(actor: Actor, kind: AnnotationKind, verseId: string, text?: string, client: PrismaClient = prisma) {
  const target: AnnotationTarget = { type: "verse", verseId };
  const result = await client.$transaction(async db => {
    await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
    await authorize(db, actor, target);
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, kind, annotationTargetKey(target)])},0))`;
    const existing = await find(db, actor.id, kind, target);
    const remove = kind === "note" ? !text?.trim() : !!existing && !existing.deletedAt;
    const action = { kind, target, actionId: randomUUID(), expectedVersion: existing?.mutationVersion ?? 0, ...(kind === "note" && !remove ? { text: text!.trim() } : {}) };
    const parsed = (remove ? annotationDeleteSchema : annotationPutSchema).safeParse(action);
    if (!parsed.success) throw new AnnotationError("INVALID");
    return write(db, actor, parsed.data, remove, existing);
  }, { timeout: 15_000 });
  if (result.changed) notify(actor.id);
  return result.annotation;
}
/** Alleen eigen opgeslagen gegevens: geen joins met beschermde broninhoud. */
export async function getAnnotation(actor: Actor, kind: AnnotationKind, id: string, client: PrismaClient = prisma) {
  const where = { id, userId: actor.id };
  const row = kind === "bookmark" ? await client.bookmark.findFirst({ where }) : kind === "highlight" ? await client.highlight.findFirst({ where }) : await client.note.findFirst({ where });
  if (!row) throw new AnnotationError("UNAVAILABLE");
  return view(kind, row);
}
export async function listAnnotations(actor: Actor, target: { verseId: string } | { lessonEditionId: string }, client: PrismaClient = prisma) {
  const where = { ...target, userId: actor.id, deletedAt: null };
  const [bookmarks, highlights, notes] = await Promise.all([
    client.bookmark.findMany({ where, take: 200, orderBy: { id: "asc" } }),
    client.highlight.findMany({ where, take: 200, orderBy: { id: "asc" } }),
    client.note.findMany({ where, take: 200, orderBy: { id: "asc" } }),
  ]);
  return [...bookmarks.map(r => view("bookmark", r)), ...highlights.map(r => view("highlight", r)), ...notes.map(r => view("note", r))];
}

/** Begrensde readerread: één hoofdstuk/revisie of exact target inclusief tombstones. */
export async function readerAnnotations(actor: Actor, filter: { chapterId: string } | { lessonEditionId: string; revisionId: string } | { targetKey: string }, client: PrismaClient = prisma) {
  if ('revisionId' in filter) {
    // Fase 4D: is dit de nu gepubliceerde revisie die de gebruiker mag lezen, dan krijgt elke eigen annotatie van deze editie
    // haar effectieve plaats (ook vanuit eerdere revisies). Anders (oud/onbekend) blijft de strikte revisiefilter gelden.
    const edition = await client.studyLessonEdition.findUnique({ where: { id: filter.lessonEditionId }, select: { lessonId: true, collectionId: true } });
    const published = edition ? await getPublishedStudyLesson(actor, edition.lessonId, edition.collectionId, client) : null;
    if (published && published.editionId === filter.lessonEditionId && published.revisionId === filter.revisionId) {
      const where = { userId: actor.id, lessonEditionId: filter.lessonEditionId, deletedAt: null };
      const groups = await Promise.all([
        client.bookmark.findMany({ where, take: 201, orderBy: { id: 'asc' } }),
        client.highlight.findMany({ where, take: 201, orderBy: { id: 'asc' } }),
        client.note.findMany({ where, take: 201, orderBy: { id: 'asc' } }),
      ]);
      return { annotations: groups.flatMap((rows, index) => rows.slice(0, 200).map(row => view((['bookmark', 'highlight', 'note'] as const)[index], row, placeAnnotation(published, row)))), complete: groups.every(rows => rows.length <= 200) };
    }
  }
  const target = 'targetKey' in filter ? { OR: [{ targetKey: filter.targetKey }, ...(filter.targetKey.startsWith('verse:') ? [{ verseId: filter.targetKey.slice(6) }] : [])] }
    : 'chapterId' in filter ? { verse: { chapterId: filter.chapterId } } : filter;
  const where = { userId: actor.id, ...target, ...('targetKey' in filter ? {} : { deletedAt: null }) };
  const groups = await Promise.all([
    client.bookmark.findMany({ where, take: 201, orderBy: { id: 'asc' } }),
    client.highlight.findMany({ where, take: 201, orderBy: { id: 'asc' } }),
    client.note.findMany({ where, take: 201, orderBy: { id: 'asc' } }),
  ]);
  return { annotations: groups.flatMap((rows, index) => rows.slice(0,200).map(row => view((['bookmark','highlight','note'] as const)[index], row))), complete: groups.every(rows => rows.length <= 200) };
}
