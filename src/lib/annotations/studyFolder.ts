import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { annotationKind, annotationColor, type AnnotationKind, type AnnotationTarget, type PassageSelector } from "./contract";
import type { AnnotationColor } from "./clientContract";

type Actor = { id: string; isAdmin: boolean };

export const STUDY_FOLDER_DEFAULT_LIMIT = 25;
export const STUDY_FOLDER_MAX_LIMIT = 50;
export const STUDY_FOLDER_MAX_QUERY = 100;
export const STUDY_FOLDER_MAX_CURSOR = 400;

export class StudyFolderError extends Error {
  constructor(readonly code: "INVALID" | "NOT_FOUND") { super(code); }
}

export type StudyFolderFilters = { q?: string; type?: AnnotationKind; source?: string; color?: AnnotationColor };
export type StudyFolderSource =
  | { status: "unavailable" }
  | {
    status: "available" | "revision-changed";
    collectionId: string;
    collectionName: string;
    language: string;
    label: string;
    href: string;
  };
export type StudyFolderItem = {
  id: string;
  kind: AnnotationKind;
  createdAt: string;
  updatedAt: string;
  text?: string;
  color?: string;
  mutationVersion: number;
  anchorStatus: string;
  targetKey: string;
  /** Eigen opgeslagen target: nodig voor de bestaande 4A-writer, bevat geen broninhoud buiten de eigen quote. */
  target: AnnotationTarget;
  /** Eigen oorspronkelijke quote van een studiepassage; blijft ook zonder toegang van de gebruiker. */
  quote?: string;
  /** Alleen gevuld als de bron nu leesbaar is. */
  snippet?: string;
  source: StudyFolderSource;
};
export type StudyFolderPage = { items: StudyFolderItem[]; nextCursor: string | null };
export type StudyFolderSources = { sources: Array<{ id: string; name: string; language: string; editionKey: string }> };

const cursorSchema = z.object({
  t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  k: annotationKind,
  i: z.string().min(1).max(128),
  h: z.string().regex(/^[a-f0-9]{32}$/),
}).strict();

/** Zoektermen: NFC, witruimte samengevoegd; zo vindt een gedecomposeerde invoer dezelfde tekst. */
export function normalizeFolderQuery(value: string | undefined): string | undefined {
  const text = (value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  if ([...text].length > STUDY_FOLDER_MAX_QUERY) throw new StudyFolderError("INVALID");
  return text;
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
/** Een cursor hoort bij precies deze gebruiker en deze filters; elders hergebruiken is ongeldig. */
function filterHash(userId: string, filters: StudyFolderFilters) {
  return createHash("sha256").update(JSON.stringify([userId, filters.q ?? null, filters.type ?? null, filters.source ?? null, filters.color ?? null])).digest("hex").slice(0, 32);
}
export function encodeFolderCursor(userId: string, filters: StudyFolderFilters, row: { createdAt: Date; kind: AnnotationKind; id: string }) {
  return Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), k: row.kind, i: row.id, h: filterHash(userId, filters) })).toString("base64url");
}
export function decodeFolderCursor(userId: string, filters: StudyFolderFilters, cursor: string) {
  if (cursor.length > STUDY_FOLDER_MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new StudyFolderError("INVALID");
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.h !== filterHash(userId, filters)) throw new StudyFolderError("INVALID");
    return parsed;
  } catch { throw new StudyFolderError("INVALID"); }
}

type Row = {
  kind: AnnotationKind; id: string; createdAt: Date; updatedAt: Date; text: string | null; color: string | null;
  verseId: string | null; lessonEditionId: string | null; revisionId: string | null; selector: PassageSelector | null;
  anchorStatus: string; mutationVersion: number; targetKey: string | null;
  open: boolean;
  collectionId: string | null; collectionName: string | null; collectionLanguage: string | null;
  bookName: string | null; chapterId: string | null; chapterNumber: number | null; verseNumber: number | null; verseText: string | null;
  lessonId: string | null; lessonTitle: string | null; publishedRevisionId: string | null;
};

/**
 * Eén gezamenlijke, begrensde query over de drie bestaande annotatietabellen.
 * Alle takken zijn aan de ingelogde gebruiker gebonden. Broninformatie wordt in SQL alleen
 * opgeleverd als de collectie nu leesbaar is (zelfde regels als readingAccessWhere); anders
 * blijft er uitsluitend eigen opgeslagen informatie over, ook in zoekresultaten en filters.
 */
async function select(actor: Actor, filters: StudyFolderFilters, extra: Prisma.Sql, limit: number, client: PrismaClient): Promise<Row[]> {
  const type = (kind: AnnotationKind) => (filters.type && filters.type !== kind ? Prisma.sql`AND FALSE` : Prisma.empty);
  // Alleen markeringen hebben een kleur: een actief kleurfilter sluit de andere twee takken uit en filtert vóór de paginering.
  const colorFilter = (kind: AnnotationKind) => (filters.color ? (kind === "highlight" ? Prisma.sql`AND x.color = ${filters.color}` : Prisma.sql`AND FALSE`) : Prisma.empty);
  const branch = (kind: AnnotationKind, table: Prisma.Sql, text: Prisma.Sql, color: Prisma.Sql, updated: Prisma.Sql) => Prisma.sql`
    SELECT ${kind}::text AS kind, x.id, x."createdAt", ${updated} AS "updatedAt", ${text} AS text, ${color} AS color,
      x."verseId", x."lessonEditionId", x."revisionId", x.selector, x."anchorStatus", x."mutationVersion", x."targetKey"
    FROM ${table} x WHERE x."userId" = ${actor.id} AND x."deletedAt" IS NULL ${type(kind)} ${colorFilter(kind)}`;
  const query = filters.q ? `%${escapeLike(filters.q)}%` : null;
  const where: Prisma.Sql[] = [];
  if (filters.source) where.push(Prisma.sql`"collectionId" = ${filters.source}`);
  // Beide kanten NFC: een eerder gedecomposeerd opgeslagen tekst vindt een samengestelde zoekterm en omgekeerd.
  if (query) where.push(Prisma.sql`(
    normalize(text, NFC) ILIKE ${query} ESCAPE '\\' OR normalize(selector->>'exact', NFC) ILIKE ${query} ESCAPE '\\'
    OR normalize("verseText", NFC) ILIKE ${query} ESCAPE '\\'
    OR normalize(concat_ws(' ', "collectionName", "bookName", "chapterNumber"::text || ':' || "verseNumber"::text, "lessonTitle"), NFC) ILIKE ${query} ESCAPE '\\')`);
  const filter = where.length ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;
  return client.$queryRaw<Row[]>(Prisma.sql`
    WITH items AS (
      ${branch("bookmark", Prisma.sql`"Bookmark"`, Prisma.sql`NULL::text`, Prisma.sql`NULL::text`, Prisma.sql`x."createdAt"`)}
      UNION ALL
      ${branch("highlight", Prisma.sql`"Highlight"`, Prisma.sql`NULL::text`, Prisma.sql`x.color`, Prisma.sql`x."createdAt"`)}
      UNION ALL
      ${branch("note", Prisma.sql`"Note"`, Prisma.sql`x.text`, Prisma.sql`NULL::text`, Prisma.sql`x."updatedAt"`)}
    ), joined AS (
      SELECT i.*,
        (cc.id IS NOT NULL AND cc.enabled AND cc.work IS NOT NULL AND cc."publicationState" IN ('LEGACY','PUBLISHED')
          AND (cc."visibleToUsers" OR ${actor.isAdmin})
          AND (i."lessonEditionId" IS NULL OR (e."publishedRevisionId" IS NOT NULL AND l."retiredAt" IS NULL))) AS open,
        cc.id AS cc_id, cc.name AS cc_name, cc.language AS cc_language,
        bk.name AS bk_name, ch.id AS ch_id, ch.number AS ch_number, v.number AS v_number, v.text AS v_text,
        l.id AS l_id, pr.title AS pr_title, e."publishedRevisionId" AS e_published
      FROM items i
      LEFT JOIN "Verse" v ON v.id = i."verseId"
      LEFT JOIN "Chapter" ch ON ch.id = v."chapterId"
      LEFT JOIN "Book" bk ON bk.id = ch."bookId"
      LEFT JOIN "StudyLessonEdition" e ON e.id = i."lessonEditionId"
      LEFT JOIN "StudyLesson" l ON l.id = e."lessonId"
      LEFT JOIN "StudyRevision" pr ON pr.id = e."publishedRevisionId"
      LEFT JOIN "ContentCollection" cc ON cc.id = COALESCE(bk."contentCollectionId", e."collectionId")
    ), gated AS (
      SELECT j.kind, j.id, j."createdAt", j."updatedAt", j.text, j.color, j."verseId", j."lessonEditionId", j."revisionId",
        j.selector, j."anchorStatus", j."mutationVersion", j."targetKey", j.open,
        CASE WHEN j.open THEN j.cc_id END AS "collectionId", CASE WHEN j.open THEN j.cc_name END AS "collectionName",
        CASE WHEN j.open THEN j.cc_language END AS "collectionLanguage", CASE WHEN j.open THEN j.bk_name END AS "bookName",
        CASE WHEN j.open THEN j.ch_id END AS "chapterId", CASE WHEN j.open THEN j.ch_number END AS "chapterNumber",
        CASE WHEN j.open THEN j.v_number END AS "verseNumber", CASE WHEN j.open THEN j.v_text END AS "verseText",
        CASE WHEN j.open THEN j.l_id END AS "lessonId", CASE WHEN j.open THEN j.pr_title END AS "lessonTitle",
        CASE WHEN j.open THEN j.e_published END AS "publishedRevisionId"
      FROM joined j
    )
    SELECT * FROM gated ${filter} ${extra.sql ? Prisma.sql`${where.length ? Prisma.sql`AND` : Prisma.sql`WHERE`} ${extra}` : Prisma.empty}
    ORDER BY "createdAt" DESC, kind ASC, id ASC
    LIMIT ${limit}`);
}

function toItem(row: Row): StudyFolderItem {
  const selector = row.selector;
  const target: AnnotationTarget = row.verseId
    ? { type: "verse", verseId: row.verseId }
    : { type: "lesson", lessonEditionId: row.lessonEditionId!, revisionId: row.revisionId!, selector: selector! };
  let source: StudyFolderSource = { status: "unavailable" };
  if (row.open && row.collectionId) {
    if (row.verseId && row.chapterId && row.verseNumber != null) {
      source = {
        status: "available", collectionId: row.collectionId, collectionName: row.collectionName!, language: row.collectionLanguage!,
        label: `${row.bookName} ${row.chapterNumber}:${row.verseNumber}`,
        href: `/lesson/${encodeURIComponent(row.chapterId)}?vers=${row.verseNumber}`,
      };
    } else if (row.lessonId && row.lessonTitle) {
      source = {
        status: row.publishedRevisionId === row.revisionId ? "available" : "revision-changed",
        collectionId: row.collectionId, collectionName: row.collectionName!, language: row.collectionLanguage!,
        label: row.lessonTitle,
        href: `/study-lesson/${encodeURIComponent(row.lessonId)}/${encodeURIComponent(row.collectionId)}?annotation=${row.kind}:${encodeURIComponent(row.id)}`,
      };
    }
  }
  const verseText = row.verseText?.replace(/\s+/gu, " ").trim();
  return {
    id: row.id, kind: row.kind, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    ...(row.kind === "note" ? { text: row.text ?? "" } : {}),
    ...(row.kind === "highlight" ? { color: row.color ?? "yellow" } : {}),
    mutationVersion: row.mutationVersion, anchorStatus: row.anchorStatus,
    targetKey: row.targetKey ?? `verse:${row.verseId}`, target,
    ...(selector ? { quote: selector.exact } : {}),
    ...(source.status !== "unavailable" && verseText ? { snippet: [...verseText].slice(0, 280).join("") } : {}),
    source,
  };
}

export async function listStudyFolder(
  actor: Actor,
  input: { q?: string; type?: AnnotationKind; source?: string; color?: string; cursor?: string; limit?: number },
  client: PrismaClient = prisma,
): Promise<StudyFolderPage> {
  const color = input.color === undefined ? undefined : annotationColor.safeParse(input.color);
  if (color && !color.success) throw new StudyFolderError("INVALID");
  // Een kleur hoort alleen bij markeringen: een ander expliciet type is een ongeldige combinatie, geen stille uitzondering.
  if (color && input.type && input.type !== "highlight") throw new StudyFolderError("INVALID");
  const filters: StudyFolderFilters = { q: normalizeFolderQuery(input.q), type: color ? "highlight" : input.type, source: input.source, color: color?.data };
  if (filters.source !== undefined && (filters.source.length < 1 || filters.source.length > 128)) throw new StudyFolderError("INVALID");
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? STUDY_FOLDER_DEFAULT_LIMIT), 1), STUDY_FOLDER_MAX_LIMIT);
  let after = Prisma.empty;
  if (input.cursor) {
    const c = decodeFolderCursor(actor.id, filters, input.cursor);
    // Gelijke timestamps worden door (kind, id) deterministisch doorgezet.
    after = Prisma.sql`("createdAt" < ${c.t}::timestamp OR ("createdAt" = ${c.t}::timestamp AND (kind > ${c.k} OR (kind = ${c.k} AND id > ${c.i}))))`;
  }
  const rows = await select(actor, filters, after, limit + 1, client);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toItem),
    nextCursor: rows.length > limit && last ? encodeFolderCursor(actor.id, filters, last) : null,
  };
}

/** Eén eigen, actief item; andere gebruikers en tombstones zijn niet te onderscheiden van "bestaat niet". */
export async function getStudyFolderItem(actor: Actor, kind: AnnotationKind, id: string, client: PrismaClient = prisma): Promise<StudyFolderItem> {
  if (!id || id.length > 128) throw new StudyFolderError("NOT_FOUND");
  const rows = await select(actor, {}, Prisma.sql`kind = ${kind} AND id = ${id}`, 1, client);
  if (!rows[0]) throw new StudyFolderError("NOT_FOUND");
  return toItem(rows[0]);
}

/** Alleen bronnen die nu leesbaar zijn: een verborgen of ingetrokken bron lekt geen naam. */
export async function listStudyFolderSources(actor: Actor, client: PrismaClient = prisma): Promise<StudyFolderSources> {
  const ids = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT DISTINCT COALESCE(bk."contentCollectionId", e."collectionId") AS id FROM (
      SELECT "verseId", "lessonEditionId" FROM "Bookmark" WHERE "userId" = ${actor.id} AND "deletedAt" IS NULL
      UNION ALL SELECT "verseId", "lessonEditionId" FROM "Highlight" WHERE "userId" = ${actor.id} AND "deletedAt" IS NULL
      UNION ALL SELECT "verseId", "lessonEditionId" FROM "Note" WHERE "userId" = ${actor.id} AND "deletedAt" IS NULL
    ) a
    LEFT JOIN "Verse" v ON v.id = a."verseId" LEFT JOIN "Chapter" ch ON ch.id = v."chapterId" LEFT JOIN "Book" bk ON bk.id = ch."bookId"
    LEFT JOIN "StudyLessonEdition" e ON e.id = a."lessonEditionId"
    LIMIT 200`);
  const found = ids.map((row) => row.id).filter(Boolean);
  if (!found.length) return { sources: [] };
  const collections = await client.contentCollection.findMany({
    where: { id: { in: found }, ...readingAccessWhere(actor) },
    select: { id: true, name: true, language: true, editionKey: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
  return { sources: collections };
}
