import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { CONTENT_IMPORT_LOCK_KEY } from "@/lib/contentImportLock";
import { OTB_COLLECTIONS } from "../../scripts/otb/trialConfig";
import sourceLock from "../../scripts/otb/source-lock.json";
import evidence from "../../scripts/otb/publication-evidence.json";
import { publicationObjectHash, publicationTextEvidence } from "../../scripts/otb/publicationEvidence";

export type ScriptureAdmin = { id: string; isAdmin: boolean; sessionVersion: number };
export type PublicationBlock = "unsupported" | "identity" | "provenance" | "evidence" | "incomplete" | "text";
export class ScripturePublicationError extends Error {
  constructor(readonly code: "FORBIDDEN" | "INVALID" | "BUSY" | "CONFLICT" | "INCOMPLETE", readonly editions?: ScripturePublicationEntry[]) { super(code); }
}
/** Prisma 7 met adapter-pg bewaart SQLSTATE onder driverAdapterError; onbekende fouten zijn geen BUSY. */
export function isScripturePublicationBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } };
  if (value.code === "P2028" || value.code === "P2034") return true;
  const sql = value.meta?.code ?? value.meta?.driverAdapterError?.cause?.originalCode;
  return value.code === "P2010" && typeof sql === "string" && ["55P03", "40001", "40P01"].includes(sql);
}
export const scripturePublicationSchema = z.object({
  actionId: z.uuid(),
  confirmation: z.literal("PUBLICEREN"),
  editions: z.array(z.object({ id: z.string().min(1).max(128), releaseToken: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(10),
}).strict().refine(input => new Set(input.editions.map(item => item.id)).size === input.editions.length);

const metadata = {
  id: true, name: true, work: true, editionKey: true, language: true, enabled: true,
  visibleToUsers: true, publicationState: true, sourceName: true, sourceUrl: true,
  licenseName: true, licenseUrl: true, contentWork: { select: { kind: true } },
} satisfies Prisma.ContentCollectionSelect;
type Collection = Prisma.ContentCollectionGetPayload<{ select: typeof metadata }>;
export interface ScripturePublicationEntry {
  id: string; name: string; work: string | null; language: string;
  enabled: boolean; visibleToUsers: boolean; publicationState: string;
  verified: boolean; canPublish: boolean; reasons: PublicationBlock[]; releaseToken: string | null;
  found: { books: number; chapters: number; verses: number } | null;
  expected: { books: number; chapters: number; verses: number } | null;
}
type Db = Prisma.TransactionClient;
async function admin(actor: ScriptureAdmin, db: Db, lock = false) {
  if (!actor.isAdmin) throw new ScripturePublicationError("FORBIDDEN");
  if (lock) await db.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR SHARE`;
  const current = await db.user.findUnique({ where: { id: actor.id }, select: { isAdmin: true, sessionVersion: true } });
  if (!current?.isAdmin || current.sessionVersion !== actor.sessionVersion) throw new ScripturePublicationError("FORBIDDEN");
}
async function inspect(collection: Collection, db: Db): Promise<ScripturePublicationEntry> {
  const config = OTB_COLLECTIONS.find(item => item.id === collection.id);
  const expected = evidence.editions.find(item => item.id === collection.id);
  const reasons: PublicationBlock[] = [];
  let found: ScripturePublicationEntry["found"] = null;
  let books: unknown = null;
  if (!config || !expected) reasons.push("unsupported");
  else if (collection.contentWork?.kind !== "SCRIPTURE" || collection.work !== config.work || collection.language !== config.language || collection.editionKey !== config.editionKey) reasons.push("identity");
  else if (evidence.schemaVersion !== 1 || evidence.upstreamCommit !== sourceLock.upstreamCommit || evidence.sourceLockHash !== publicationObjectHash(sourceLock)) reasons.push("evidence");
  else if (collection.sourceName !== "Open Translation Bible" || collection.sourceUrl !== `${sourceLock.sourceUrl}/lang/${config.locale}` || collection.licenseName !== sourceLock.license || collection.licenseUrl !== sourceLock.licenseUrl) reasons.push("provenance");
  else {
    const [counts] = await db.$queryRaw<{ books: number; chapters: number; verses: number }[]>`
      SELECT count(DISTINCT b.id)::int AS books, count(DISTINCT c.id)::int AS chapters, count(v.id)::int AS verses
      FROM "Book" b LEFT JOIN "Chapter" c ON c."bookId"=b.id LEFT JOIN "Verse" v ON v."chapterId"=c.id
      WHERE b."contentCollectionId"=${collection.id}`;
    found = counts;
    if (counts.books !== expected.books || counts.chapters !== expected.chapters || counts.verses !== expected.verses) reasons.push("incomplete");
    else {
      // De telling begrenst de totale hoeveelheid. Extra lege/onjuiste posities blijven in de digest zichtbaar.
      const actual = await db.book.findMany({ where: { contentCollectionId: collection.id }, orderBy: [{ order: "asc" }, { id: "asc" }], select: {
        id: true, key: true, slug: true, name: true, order: true,
        chapters: { orderBy: { number: "asc" }, select: { id: true, number: true, order: true, heading: true,
          verses: { orderBy: { number: "asc" }, select: { id: true, number: true, text: true } } } },
      } });
      books = actual;
      if (actual.some(book => book.chapters.some(chapter => chapter.heading !== null)) || publicationTextEvidence(actual).sha256 !== expected.sha256) reasons.push("text");
    }
  }
  const verified = reasons.length === 0;
  return {
    id: collection.id, name: collection.name, work: collection.work, language: collection.language,
    enabled: collection.enabled, visibleToUsers: collection.visibleToUsers, publicationState: collection.publicationState,
    verified, canPublish: verified && collection.publicationState === "DRAFT", reasons,
    releaseToken: verified ? publicationObjectHash([collection, books, evidence.upstreamCommit]) : null,
    found, expected: expected ? { books: expected.books, chapters: expected.chapters, verses: expected.verses } : null,
  };
}
export async function scripturePublicationState(actor: ScriptureAdmin, client: PrismaClient = prisma) {
  await admin(actor, client);
  const collections = await client.contentCollection.findMany({
    where: { OR: [{ work: { in: ["old-testament", "new-testament"] } }, { id: { in: OTB_COLLECTIONS.map(item => item.id) } }] },
    orderBy: [{ order: "asc" }, { id: "asc" }], select: metadata,
  });
  // Geen procescache van inhoud of rechten; iedere controle leest de actuele database.
  const editions: ScripturePublicationEntry[] = [];
  for (const collection of collections) editions.push(await inspect(collection, client));
  return { editions };
}
export async function publishScriptureCollections(actor: ScriptureAdmin, raw: unknown, client: PrismaClient = prisma) {
  if (!actor.isAdmin) throw new ScripturePublicationError("FORBIDDEN");
  const parsed = scripturePublicationSchema.safeParse(raw);
  if (!parsed.success) throw new ScripturePublicationError("INVALID");
  const input = parsed.data;
  const selected = [...input.editions].sort((a,b) => a.id.localeCompare(b.id));
  const requestHash = publicationObjectHash({ actor: actor.id, editions: selected });
  return client.$transaction(async db => {
    await db.$executeRaw`SET LOCAL lock_timeout='1500ms'`;
    // Het bestaande importslot, transactioneel vastgehouden: verlies van de verbinding kan nooit los publiceren.
    const [lock] = await db.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(${CONTENT_IMPORT_LOCK_KEY}::bigint) AS ok`;
    if (!lock.ok) throw new ScripturePublicationError("BUSY");
    await admin(actor, db, true);
    const previous = await db.contentUpdateRun.findUnique({ where: { id: input.actionId } });
    if (previous) {
      if (previous.kind !== "SCRIPTURE_RELEASE" || previous.createdById !== actor.id || previous.planHash !== requestHash || previous.status !== "OK") throw new ScripturePublicationError("CONFLICT");
      return { changed: 0, replayed: true, results: previous.sources };
    }
    const ids = selected.map(item => item.id);
    await db.$queryRaw`SELECT id FROM "ContentCollection" WHERE id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
    let collections = await db.contentCollection.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: metadata });
    if (collections.length !== ids.length) throw new ScripturePublicationError("INVALID");
    const works = collections.map(item => item.work).filter((key): key is string => key !== null);
    await db.$queryRaw`SELECT key FROM "ContentWork" WHERE key=ANY(${works}::text[]) ORDER BY key FOR SHARE`;
    collections = await db.contentCollection.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, select: metadata });
    // Alleen tijdens bevestiging: voorkomt ook phantom-inserts tussen inhoudscontrole en commit.
    // Lezers en voortgangstabellen blijven vrij. Een actieve tekstschrijver levert direct BUSY op.
    await db.$executeRawUnsafe('LOCK TABLE "Book", "Chapter", "Verse" IN SHARE MODE NOWAIT');
    const states: ScripturePublicationEntry[] = [];
    for (const collection of collections) states.push(await inspect(collection, db));
    if (states.some(item => !item.verified)) throw new ScripturePublicationError("INCOMPLETE", states);
    if (states.some((item,i) => !item.canPublish || item.releaseToken !== selected[i].releaseToken)) throw new ScripturePublicationError("CONFLICT", states);
    const results = states.map(item => ({ id: item.id, name: item.name, status: "PUBLISHED", enabled: item.enabled, visibleToUsers: item.visibleToUsers }));
    const updated = await db.contentCollection.updateMany({ where: { id: { in: ids }, publicationState: "DRAFT" }, data: { publicationState: "PUBLISHED" } });
    if (updated.count !== ids.length) throw new ScripturePublicationError("CONFLICT");
    await db.contentUpdateRun.create({ data: {
      id: input.actionId, kind: "SCRIPTURE_RELEASE", status: "OK", createdById: actor.id,
      finishedAt: new Date(), planHash: requestHash,
      plan: { editions: selected, sourceCommit: evidence.upstreamCommit }, sources: results,
    } });
    return { changed: ids.length, replayed: false, results };
  });
}
