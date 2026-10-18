import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FsyLesson, ContentCollection, ContentMedia, Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { requireStudyAdmin, studyObjectHash, StudyPublishingError, type StudyAdmin } from "./policy";
import { appendStudyRevision } from "./revisions";
import { parseStudyDocument, type StudyDocument } from "./schema";
import { readStudyMedia, validateStudyMediaMetadata } from "./storage";
import { snapshotIdentity, snapshotRevisionInput, studyDocumentInventory, validateSnapshotItem, type StudySnapshot, type SnapshotItem } from "./fixtureAdapter";

type Tx = Prisma.TransactionClient;
const block = z.discriminatedUnion("type", [
  z.object({ type: z.enum(["heading", "paragraph", "list-item", "quote"]), text: z.string().min(1) }).strict(),
  z.object({ type: z.literal("image"), url: z.url(), alt: z.string().optional() }).strict(),
]);
const blocks = z.array(block).min(1).max(1000);
const images = z.array(z.object({ url: z.url(), alt: z.string() }).strict()).max(100);
export class FsyConversionError extends Error {
  constructor(readonly code: "SOURCE" | "RIGHTS" | "CONTENT" | "MEDIA" | "CONFLICT" | "UNAVAILABLE") { super(code); }
}
/** De bewaarde rij is de legacy-snapshot; mapping wijzigt haar tekst/hash/timestamps nooit. */
export function fsyLegacyIdentity(row: FsyLesson) {
  return studyObjectHash(JSON.parse(JSON.stringify({ ...row, studyLessonEditionId: undefined, contentCollection: undefined })));
}
export const fsyConversionActionSchema = z.object({
  expectedLegacyHash: z.string().regex(/^[a-f0-9]{64}$/), actionId: z.uuid(), confirm: z.literal("CONVERT_EXISTING_FSY"),
}).strict();
function requireSource(row: FsyLesson, collection: ContentCollection) {
  let url: URL;
  try { url = new URL(row.sourceUrl); } catch { throw new FsyConversionError("SOURCE"); }
  const path = `/study/ftsoy/${row.year}/${String(row.month).padStart(2, "0")}`;
  if (collection.work !== "fsy" || collection.language !== "nl" || !collection.editionKey ||
      row.month < 1 || row.month > 12 || row.year < 2000 || row.year > 2200 || !row.category ||
      url.protocol !== "https:" || url.hostname !== "www.churchofjesuschrist.org" || url.username || url.password || url.port ||
      !(url.pathname === path || url.pathname.startsWith(`${path}/`)) || url.searchParams.get("lang") !== "nld") throw new FsyConversionError("SOURCE");
  if (!collection.sourceName?.trim() || !collection.licenseName?.trim()) throw new FsyConversionError("RIGHTS");
  return { holder: collection.sourceName, permission: collection.licenseName, ...(collection.licenseUrl ? { licenseUrl: collection.licenseUrl } : {}) };
}
/** Geen scrape: alleen exacte opgeslagen kopieën en reeds gepinde READY-media. */
async function prepareVersion(db: Tx, row: FsyLesson, collection: ContentCollection, published: boolean): Promise<SnapshotItem> {
  const rights = requireSource(row, collection);
  let parsed: z.infer<typeof blocks>, inventoryImages: z.infer<typeof images>;
  try {
    parsed = blocks.parse(JSON.parse((published ? row.publishedContent : row.content) ?? "null"));
    inventoryImages = images.parse(JSON.parse((published ? row.publishedImages : row.images) ?? "null"));
  } catch { throw new FsyConversionError("CONTENT"); }
  const body: StudyDocument = { schemaVersion: 1, sections: [{ id: `legacy-${randomUUID()}`, blocks: [] }] };
  const assets: SnapshotItem["media"] = [];
  const pins = new Map<string, ContentMedia>();
  let mediaBytes = 0;
  for (const source of [...parsed.filter(b => b.type === "image").map(b => b.url), ...inventoryImages.map(i => i.url)]) {
    if (pins.has(source)) continue;
    const candidates = await db.contentMedia.findMany({ where: { sourceUrl: source, status: "READY" }, take: 2 });
    const medium = candidates.length === 1 ? candidates[0] : null;
    if (!medium) throw new FsyConversionError("MEDIA");
    mediaBytes += medium.byteSize;
    if (mediaBytes > 20 * 1024 * 1024) throw new FsyConversionError("MEDIA");
    try { validateStudyMediaMetadata(medium); await readStudyMedia(medium, false); } catch { throw new FsyConversionError("MEDIA"); }
    pins.set(source, medium);
  }
  // Legacy-ankers bestonden niet. Deze nieuwe ids worden éénmaal in de immutable snapshot bewaard,
  // niet uit tekst/titel/arraypositie afgeleid en niet fuzzy tussen concept en publicatie gelijkgesteld.
  const represented = new Set<string>();
  for (const item of parsed) {
    if (body.sections.at(-1)!.blocks.length === 200) body.sections.push({ id: `legacy-${randomUUID()}`, blocks: [] });
    const id = `legacy-${randomUUID()}`;
    if (item.type === "image") {
      const media = pins.get(item.url)!;
      const mediaKey = `media-${randomUUID()}`;
      body.sections.at(-1)!.blocks.push({ id, type: "figure", mediaKey, width: media.width, height: media.height, alt: item.alt ?? "" });
      assets.push({ mediaKey, base64: (await readStudyMedia(media, false)).toString("base64"), checksum: media.checksum, mimeType: media.mimeType, sourceKey: item.url, rights: media.rightsMetadata as SnapshotItem["rightsMetadata"] });
      represented.add(item.url);
    } else if (item.type === "list-item") {
      body.sections.at(-1)!.blocks.push({ id, type: "list", ordered: false, items: [{ id: `legacy-${randomUUID()}`, content: [{ type: "text", text: item.text }] }] });
    } else body.sections.at(-1)!.blocks.push({ id, type: item.type, ...(item.type === "heading" ? { level: 2 } : {}), content: [{ type: "text", text: item.text }] } as StudyDocument["sections"][number]["blocks"][number]);
  }
  // Losse legacy-afbeeldingen hebben geen bewezen plaats in de leestekst: niet gokken.
  if (inventoryImages.some(i => !represented.has(i.url))) throw new FsyConversionError("MEDIA");
  parseStudyDocument(body);
  const inventory = studyDocumentInventory(body);
  const item: SnapshotItem = {
    schemaVersion: 1, title: (published ? row.publishedTitle : row.title) ?? "", body,
    sourceKey: `fsy:${row.id}`, slug: `legacy-${row.id.toLowerCase().replace(/[^a-z0-9]/g, "-")}`, order: row.order,
    sourceMetadata: { sourceKey: `fsy:${row.id}`, url: row.sourceUrl, name: collection.sourceName! }, rightsMetadata: rights,
    media: assets, expectedAnchors: inventory.anchors, expectedMedia: assets.map(a => a.mediaKey), expectedReferences: [], evidence: [],
  };
  validateSnapshotItem(item);
  return item;
}
async function load(db: Tx, actor: StudyAdmin, id: string) {
  requireStudyAdmin(actor);
  const row = await db.fsyLesson.findUnique({ where: { id }, include: { contentCollection: true } });
  if (!row || row.contentCollection.work !== "fsy" || !await db.contentCollection.findFirst({ where: { id: row.contentCollectionId, ...readingAccessWhere(actor, "admin-preview") } })) throw new FsyConversionError("UNAVAILABLE");
  return row;
}
export async function reviewFsyConversion(actor: StudyAdmin, id: string, client: PrismaClient = prisma) {
  return client.$transaction(async db => {
    await db.$executeRaw`SET TRANSACTION READ ONLY`;
    const row = await load(db, actor, id);
    const edition = row.studyLessonEditionId ? await db.studyLessonEdition.findUnique({ where: { id: row.studyLessonEditionId }, select: { publicationVersion: true } }) : null;
    const issues: string[] = ["LEGACY_INLINE_LINKS_NOT_RECONSTRUCTED"];
    try {
      if (row.publishedContent !== null) await prepareVersion(db, row, row.contentCollection, true);
      await prepareVersion(db, row, row.contentCollection, false);
    } catch (e) { issues.push(e instanceof FsyConversionError ? e.code : "CONTENT"); }
    return { legacyId: id, legacyHash: fsyLegacyIdentity(row), editionId: row.studyLessonEditionId, publicationVersion: edition?.publicationVersion ?? 0, ready: issues.length === 1, issues };
  }, { timeout: 30_000 });
}

/** Atomische row-lock = writerhandover; geen startup/reload-pad roept dit aan. */
export async function convertFsyLesson(actor: StudyAdmin, id: string, raw: z.infer<typeof fsyConversionActionSchema>, client: PrismaClient = prisma) {
  requireStudyAdmin(actor);
  const input = fsyConversionActionSchema.parse(raw);
  return client.$transaction(async db => {
    await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
    await db.$queryRaw`SELECT id FROM "FsyLesson" WHERE id=${id} FOR UPDATE`;
    const row = await load(db, actor, id);
    const hash = fsyLegacyIdentity(row);
    if (input.expectedLegacyHash !== hash) throw new FsyConversionError("CONFLICT");
    const previous = await db.contentImportRun.findUnique({ where: { id: `fsy-${input.actionId}-draft` } });
    if (previous && (previous.createdByKey !== actor.id || (previous.snapshot as { legacy?: { id?: string } }).legacy?.id !== id)) throw new FsyConversionError("CONFLICT");
    if (previous || row.studyLessonEditionId) return { changed: false, editionId: row.studyLessonEditionId };
    const draft = await prepareVersion(db, row, row.contentCollection, false);
    const published = row.publishedContent !== null ? await prepareVersion(db, row, row.contentCollection, true) : null;
    const period = await db.studyPeriod.upsert({
      where: { workKey_sourceKey: { workKey: "fsy", sourceKey: `fsy:${row.contentCollectionId}:${row.year}` } }, update: {},
      create: { workKey: "fsy", sourceKey: `fsy:${row.contentCollectionId}:${row.year}`, label: `FSY ${row.year}`, year: row.year, metadata: { legacyCollectionId: row.contentCollectionId } },
    });
    const lesson = await db.studyLesson.upsert({ where: { workKey_periodId_sourceKey: { workKey: "fsy", periodId: period.id, sourceKey: `fsy:${id}` } }, update: { retiredAt: null }, create: { workKey: "fsy", periodId: period.id, sourceKey: `fsy:${id}`, month: row.month, categoryKey: row.category, order: row.order } });
    const edition = await db.studyLessonEdition.upsert({ where: { lessonId_collectionId: { lessonId: lesson.id, collectionId: row.contentCollectionId } }, update: {}, create: { lessonId: lesson.id, collectionId: row.contentCollectionId, workKey: "fsy", slug: draft.slug } });
    async function retain(item: SnapshotItem, kind: "published" | "draft", existing?: Awaited<ReturnType<typeof appendStudyRevision>>) {
      const snapshot: StudySnapshot & { legacy: unknown } = {
        adapterName: "fsy-legacy-v1", adapterVersion: "1", workKey: "fsy", editionKey: row.contentCollection.editionKey, language: "nl", synthetic: false,
        sourceVersion: `LEGACY_MIGRATED:${hash}:${kind}`, period: { sourceKey: period.sourceKey, label: period.label, year: row.year }, items: [item],
        legacy: { id, hash, payload: JSON.parse(JSON.stringify({ ...row, contentCollection: undefined, studyLessonEditionId: undefined })), kind, originalPublishedAt: row.publishedAt?.toISOString() ?? null },
      };
      const revision = existing ?? await appendStudyRevision(actor, edition.id, snapshotRevisionInput(item), db);
      const run = await db.contentImportRun.create({ data: {
        id: `fsy-${input.actionId}-${kind}`, adapterName: snapshot.adapterName, adapterVersion: "1", workKey: "fsy", collectionId: row.contentCollectionId, periodId: period.id, periodSourceKey: period.sourceKey,
        editionKey: snapshot.editionKey, language: "nl", sourceVersion: snapshot.sourceVersion, sourceHash: snapshotIdentity(snapshot), scopeKey: studyObjectHash({ adapter: "fsy-legacy-v1", legacyId: id }),
        snapshot: JSON.parse(JSON.stringify(snapshot)), status: "DRAFT_READY", foundItems: 1, validatedItems: 1, processedItems: 1,
        createdById: actor.id, createdByKey: actor.id, finishedAt: new Date(), diagnostics: ["LEGACY_MIGRATED", "LEGACY_INLINE_LINKS_NOT_RECONSTRUCTED"],
      } });
      await db.contentImportItem.create({ data: { runId: run.id, sourceKey: item.sourceKey, lessonEditionId: edition.id, revisionId: revision.id } });
      for (const asset of existing ? [] : item.media) {
        const media = await db.contentMedia.findUniqueOrThrow({ where: { checksum: asset.checksum } });
        await db.studyRevisionMedia.create({ data: { revisionId: revision.id, mediaId: media.id, mediaKey: asset.mediaKey } });
      }
      return revision;
    }
    const pub = published ? await retain(published, "published") : null;
    // Vergelijk de oorspronkelijke kopieën, niet de nieuw toegekende ankers of de huidige bronhash.
    const differs = row.content !== row.publishedContent || row.title !== row.publishedTitle || row.images !== row.publishedImages;
    const draftRevision = await retain(pub && !differs ? published! : draft, "draft", pub && !differs ? pub : undefined);
    await db.studyLessonEdition.update({ where: { id: edition.id }, data: { publishedRevisionId: pub?.id ?? null, draftRevisionId: !pub || differs ? draftRevision.id : null, publicationVersion: { increment: 1 } } });
    if (pub) await db.studyPublicationAction.create({ data: {
      lessonEditionId: edition.id, revisionId: pub.id, previousRevisionId: edition.publishedRevisionId,
      importRunId: `fsy-${input.actionId}-published`, actorId: actor.id, actorKey: actor.id, actionId: input.actionId,
      kind: "PUBLISH", expectedVersion: edition.publicationVersion, version: edition.publicationVersion + 1,
      requestHash: studyObjectHash({ kind: "LEGACY_MIGRATED", legacyId: id, legacyHash: hash, actionId: input.actionId }),
    } });
    await db.$executeRaw`SELECT set_config('versado.fsy_handover','convert',true)`;
    await db.fsyLesson.update({ where: { id }, data: { studyLessonEditionId: edition.id } });
    return { changed: true, editionId: edition.id };
  }, { maxWait: 5000, timeout: 30_000 });
}

/** Bestaande gedeelde publisher herleidt de immutable snapshot naar de bevroren legacyrij. */
export async function requireFsyPublicationSource(db: Tx, run: { snapshot: unknown; collectionId: string }, editionId: string) {
  const snapshot = run.snapshot as StudySnapshot & { legacy?: { id?: string; hash?: string; kind?: string; payload?: FsyLesson } };
  const legacy = snapshot.legacy;
  if (!legacy?.id || !legacy.payload || !["published", "draft"].includes(legacy.kind ?? "")) throw new StudyPublishingError("INCOMPLETE");
  const row = await db.fsyLesson.findUnique({ where: { id: legacy.id }, include: { contentCollection: true } });
  if (!row || row.studyLessonEditionId !== editionId || row.contentCollectionId !== run.collectionId || fsyLegacyIdentity(row) !== legacy.hash || fsyLegacyIdentity(legacy.payload) !== legacy.hash) throw new StudyPublishingError("INCOMPLETE");
  const rights = requireSource(row, row.contentCollection);
  const item = snapshot.items[0];
  const published = legacy.kind === "published";
  if (snapshot.items.length !== 1 || item.title !== (published ? row.publishedTitle : row.title) || item.sourceKey !== `fsy:${row.id}` || item.sourceMetadata.url !== row.sourceUrl || studyObjectHash(item.rightsMetadata) !== studyObjectHash(rights)) throw new StudyPublishingError("INCOMPLETE");
  // Verifieer de volledige legacybetekenis, niet alleen een door de caller opgegeven hash.
  const original = blocks.parse(JSON.parse((published ? row.publishedContent : row.content) ?? "null"));
  const actual = parseStudyDocument(item.body).sections.flatMap(s => s.blocks);
  if (original.length !== actual.length) throw new StudyPublishingError("INCOMPLETE");
  for (const [index, source] of original.entries()) {
    const target = actual[index];
    let valid = false;
    if (source.type === "image" && target.type === "figure") {
      const asset = item.media.find(a => a.mediaKey === target.mediaKey);
      valid = asset?.sourceKey === source.url && target.alt === (source.alt ?? "") && !target.caption;
    } else if (source.type === "list-item" && target.type === "list") {
      valid = !target.ordered && target.items.length === 1 && !target.items[0].children && !target.items[0].blocks &&
        studyObjectHash(target.items[0].content) === studyObjectHash([{ type: "text", text: source.text }]);
    } else if (source.type === target.type && "content" in target && "text" in source) {
      valid = studyObjectHash(target.content) === studyObjectHash([{ type: "text", text: source.text }]) &&
        (target.type !== "heading" || target.level === 2) && (target.type !== "quote" || !target.attribution);
    }
    if (!valid) throw new StudyPublishingError("INCOMPLETE");
  }

}

/** Writerrollback behoudt alle nieuwe revisies; alleen nog ongewijzigde conversies kunnen terug. */
export async function rollbackFsyWriter(actor: StudyAdmin, id: string, expectedVersion: number, client: PrismaClient = prisma) {
  requireStudyAdmin(actor);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new FsyConversionError("CONFLICT");
  return client.$transaction(async db => {
    await db.$queryRaw`SELECT id FROM "FsyLesson" WHERE id=${id} FOR UPDATE`;
    const row = await load(db, actor, id);
    if (!row.studyLessonEditionId) return { changed: false };
    await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${row.studyLessonEditionId} FOR UPDATE`;
    const edition = await db.studyLessonEdition.findUniqueOrThrow({ where: { id: row.studyLessonEditionId } });
    if (edition.publicationVersion !== expectedVersion) throw new FsyConversionError("CONFLICT");
    const items = await db.contentImportItem.findMany({ where: { lessonEditionId: edition.id, revisionId: { in: [edition.publishedRevisionId, edition.draftRevisionId].filter((v): v is string => Boolean(v)) } }, include: { run: true } });
    const published = items.find(i => i.revisionId === edition.publishedRevisionId && (i.run.snapshot as { legacy?: { kind?: string } }).legacy?.kind === "published");
    const draft = items.find(i => i.revisionId === edition.draftRevisionId && (i.run.snapshot as { legacy?: { kind?: string } }).legacy?.kind === "draft");
    if ((edition.publishedRevisionId && !published) || (edition.draftRevisionId && !draft) ||
        (published && draft && published.runId.replace(/-published$/, "") !== draft.runId.replace(/-draft$/, ""))) throw new FsyConversionError("CONFLICT");
    // Na nieuwe publicatie (ook van het originele concept) is terugkeer naar de oude writer niet stilzwijgend veilig.
    const last = await db.studyPublicationAction.findFirst({ where: { lessonEditionId: edition.id }, orderBy: { version: "desc" } });
    if (last && (last.version !== edition.publicationVersion || !published || last.importRunId !== published.runId)) throw new FsyConversionError("CONFLICT");
    await db.studyLesson.update({ where: { id: edition.lessonId }, data: { retiredAt: new Date() } });
    await db.$executeRaw`SELECT set_config('versado.fsy_handover','rollback',true)`;
    await db.fsyLesson.update({ where: { id }, data: { studyLessonEditionId: null } });
    return { changed: true };
  }, { timeout: 10_000 });
}
