import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { audioDir, mirrorFileName } from "@/lib/audioMirror";
import { prisma } from "@/lib/db";
import { readingAccessWhere, collectionAccessWhere, type ContentActor } from "@/lib/contentAccess";
import { audioRoot, safeDirectory, readBounded, storeAudio, verifyObject } from "./storage";
import { manifestSchema, segmentsSchema, packageId, sha256, chapterSourceHash, validateSegments, type AudioManifest } from "./contract";
import { assertLegacyBaseline, legacyFallback } from "./legacyConversion";
import { officialSource } from "./officialCatalogue";
import { assertOfficialRegistration, assertOfficialPublication } from "./officialGuard";

type DB = PrismaClient | Prisma.TransactionClient;
async function target(db: DB, manifest: AudioManifest) {
  if (manifest.target.kind !== "CHAPTER" || !["bofm", "dc-testament", "pgp"].includes(manifest.work)) throw new Error("PHASE_NOT_ENABLED");
  const chapter = await db.chapter.findFirst({ where: { number: manifest.target.chapterNumber, book: { key: manifest.target.bookKey, contentCollectionId: manifest.collectionId } }, include: { book: { include: { contentCollection: true } }, verses: { orderBy: { number: "asc" } } } });
  if (!chapter) throw new Error("TARGET_MISSING");
  const collection = chapter.book.contentCollection;
  if (collection.work !== manifest.work || collection.language !== manifest.language || collection.editionKey !== manifest.editionKey || chapterSourceHash(chapter) !== manifest.sourceHash) throw new Error("SOURCE_MISMATCH");
  return chapter;
}
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

/** Geen publicatie: meerdere processen claimen één duurzame receipt met een lease en fencing-token. */
export async function importAudioPackage(folder: string, db: PrismaClient = prisma) {
  const name = path.basename(folder);
  if (!packageId.safeParse(name).success) throw new Error("PACKAGE_NAME");
  const incoming = await safeDirectory(await audioRoot(), "incoming");
  if (folder !== await safeDirectory(incoming, name)) throw new Error("PACKAGE_PATH");
  await readBounded(path.join(folder, "READY"), 100);
  let raw: Buffer;
  try { raw = await readBounded(path.join(folder, "manifest.json"), 65536); }
  catch {
    const until = new Date(Date.now() + 3600000), invalidHash = sha256("MANIFEST_UNREADABLE");
    await db.audioPackage.createMany({ data: { id: name, manifestHash: invalidHash, status: "FAILED", leaseToken: randomUUID(), leaseUntil: until, errorCode: "MANIFEST_UNREADABLE" }, skipDuplicates: true });
    await db.audioPackage.updateMany({ where: { id: name, status: { in: ["FAILED", "PROCESSING"] }, leaseUntil: { lte: new Date() } }, data: { status: "FAILED", errorCode: "MANIFEST_UNREADABLE", leaseToken: randomUUID(), leaseUntil: until, attempts: { increment: 1 } } });
    return db.audioPackage.findUniqueOrThrow({ where: { id: name } });
  }
  const manifestHash = sha256(raw), token = randomUUID(), now = new Date();
  // Ook ongeldige manifesten krijgen een zichtbare foutregistratie.
  await db.audioPackage.createMany({ data: { id: name, manifestHash, leaseToken: token, leaseUntil: new Date(now.getTime() + 300000) }, skipDuplicates: true });
  let receipt = await db.audioPackage.findUniqueOrThrow({ where: { id: name } });
  if (receipt.manifestHash === sha256("MANIFEST_UNREADABLE") && receipt.status === "FAILED") {
    // Bij een leesfout zijn nog geen manifestbytes geclaimd. Pin de eerste daadwerkelijk leesbare versie na backoff.
    if (receipt.leaseUntil > now) return receipt;
    await db.audioPackage.updateMany({ where: { id: name, manifestHash: receipt.manifestHash, status: "FAILED", leaseUntil: { lte: now } }, data: { manifestHash, status: "PROCESSING", leaseToken: token, leaseUntil: new Date(now.getTime() + 300000), attempts: { increment: 1 }, errorCode: null } });
    receipt = await db.audioPackage.findUniqueOrThrow({ where: { id: name } });
  }
  if (receipt.manifestHash !== manifestHash) throw new Error("PACKAGE_ID_REUSED");
  if (receipt.status === "READY") return receipt;
  if (receipt.leaseToken !== token) {
    const acquired = await db.audioPackage.updateMany({ where: { id: name, manifestHash, leaseUntil: { lte: now }, status: { in: ["FAILED", "PROCESSING"] } }, data: { status: "PROCESSING", leaseToken: token, leaseUntil: new Date(now.getTime() + 300000), attempts: { increment: 1 }, errorCode: null } });
    if (!acquired.count) return receipt;
  }
  try {
    const manifest = manifestSchema.parse(JSON.parse(raw.toString("utf8")));
    if (manifest.packageId !== name) throw new Error("PACKAGE_ID_MISMATCH");
    const chapter = await target(db, manifest);
    const segmentBytes = await readBounded(path.join(folder, "segments.json"), 2 * 1024 * 1024);
    if (sha256(segmentBytes) !== manifest.segments.sha256) throw new Error("SEGMENT_CHECKSUM");
    const segments = segmentsSchema.parse(JSON.parse(segmentBytes.toString("utf8"))).segments;
    // Onuitgelijnde bestanden zijn uitsluitend herkenbare, niet-publiceerbare reviewkandidaten.
    if (segments.length || manifest.quality === "VALIDATED") validateSegments(segments, chapter.verses, manifest.audio.duration);
    let report: unknown = null;
    if (manifest.qualityReport) {
      const bytes = await readBounded(path.join(folder, "quality-report.json"), 1024 * 1024);
      if (sha256(bytes) !== manifest.qualityReport.sha256) throw new Error("QUALITY_CHECKSUM");
      report = JSON.parse(bytes.toString("utf8"));
    }
    await storeAudio(folder, manifest);
    await db.$transaction(async (tx) => {
      await assertOfficialRegistration(tx, manifest);
      // Canonieke bronidentiteit, ook voor de bestaande officiële CLI. Een nieuw checkedAt geeft geen tweede opname.
      if (manifest.sourceKind === "OFFICIAL") await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([manifest.collectionId, manifest.target, manifest.sourceHash, manifest.audio.sha256, manifest.voice.name, manifest.source.url,manifest.quality,sha256(JSON.stringify(segments))])}, 0))::text`;
      const claimed = await tx.audioPackage.updateMany({ where: { id: name, leaseToken: token, status: "PROCESSING", leaseUntil: { gt: new Date() } }, data: { status: "READY", errorCode: null } });
      if (!claimed.count) throw new Error("LEASE_LOST");
      // De tekst mag niet tussen de controle en registratie veranderen, ook bij verloren importlockverbinding.
      await tx.$queryRaw`SELECT "id" FROM "Chapter" WHERE "id" = ${chapter.id} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "Verse" WHERE "chapterId" = ${chapter.id} ORDER BY "id" FOR SHARE`;
      const current=await target(tx, manifest);
      const source=manifest.packageId.startsWith("admin-official-")?officialSource(manifest.packageId.slice("admin-official-".length)):undefined;
      if(source?.legacyProtected)await assertLegacyBaseline(tx,source);
      if (current.id !== chapter.id) throw Error("SOURCE_MISMATCH");
      if(segments.length||manifest.quality==="VALIDATED")validateSegments(segments,current.verses,manifest.audio.duration);
      if (manifest.sourceKind === "OFFICIAL" && await tx.audioRecording.findFirst({ where: { collectionId: manifest.collectionId, chapterId: chapter.id, sourceHash: manifest.sourceHash, sha256: manifest.audio.sha256, sourceKind: "OFFICIAL",quality:{path:["status"],equals:manifest.quality},segments:{equals:json(segments)}, voice: { path: ["name"], equals: manifest.voice.name }, sourceMetadata: { path: ["url"], equals: manifest.source.url ?? "" } } })) return;
      await tx.audioRecording.create({ data: { packageId: name, targetKey: `chapter:${chapter.id}`, chapterId: chapter.id, collectionId: manifest.collectionId, work: manifest.work, editionKey: manifest.editionKey, language: manifest.language, sourceHash: manifest.sourceHash, sourceKind: manifest.sourceKind, sourceMetadata: json(manifest.source), voice: json(manifest.voice), quality: json({ status: manifest.quality, report }), segments: json(segments), sha256: manifest.audio.sha256, byteSize: manifest.audio.bytes, duration: manifest.audio.duration } });
    });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]{2,80}$/.test(error.message) ? error.message : "INVALID_PACKAGE_OR_STORAGE";
    await db.audioPackage.updateMany({ where: { id: name, leaseToken: token, status: "PROCESSING" }, data: { status: "FAILED", errorCode: code, leaseUntil: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(receipt.attempts, 7))) } });
  }
  receipt = await db.audioPackage.findUniqueOrThrow({ where: { id: name } });
  return receipt;
}
let scanning = false;
export async function scanAudioPackages(db: PrismaClient = prisma) {
  if (scanning || !process.env.AUDIO_DIR) return;
  scanning = true;
  try {
    const incoming = await safeDirectory(await audioRoot(), "incoming", true);
    // Begrensde serie; volgende tick hervat via receipts, READY heeft geen dure decode meer.
    const names = (await fs.readdir(incoming, { withFileTypes: true })).filter((e) => e.isDirectory() && packageId.safeParse(e.name).success).map((e) => e.name).sort();
    const receipts = new Map((await db.audioPackage.findMany({ select: { id: true, status: true, leaseUntil: true } })).map((r) => [r.id, r]));
    let attempted = 0;
    for (const name of names) {
      const receipt = receipts.get(name);
      if (receipt?.status === "READY" || (receipt && receipt.leaseUntil > new Date())) continue;
      // Onvolledige mappen tellen niet mee: zij mogen latere complete pakketten niet laten verhongeren.
      try { await readBounded(path.join(incoming, name, "READY"), 100); } catch { continue; }
      try { await importAudioPackage(path.join(incoming, name), db); }
      catch { console.warn(`Audiopakket ${name}: onvolledig, onveilig of gewijzigde pakketidentiteit.`); }
      if (++attempted >= 20) break;
    }
  } finally { scanning = false; }
}

/** Alleen bestaande beheeridentiteit; publiceert audio, nooit de bijbehorende contentcollectie. */
export async function publishAudio(actor: { id: string; isAdmin: boolean; sessionVersion: number }, recordingId: string, expectedVersion: number, db: PrismaClient = prisma, options: { onlyIfUnpublished?: boolean } = {}) {
  if (!actor.isAdmin) throw new Error("FORBIDDEN");
  const candidate = await db.audioRecording.findUniqueOrThrow({ where: { id: recordingId } });
  if (!candidate.chapterId || (candidate.quality as { status?: string }).status !== "VALIDATED") throw new Error("QUALITY_REVIEW_REQUIRED");
  await verifyObject(candidate.sha256, candidate.byteSize);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.id } });
    if (!user?.isAdmin || user.sessionVersion !== actor.sessionVersion) throw new Error("FORBIDDEN");
    const conversion=await assertOfficialPublication(tx, candidate);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${candidate.targetKey}, 0))::text`;
    await tx.$queryRaw`SELECT "id" FROM "Chapter" WHERE "id" = ${candidate.chapterId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Verse" WHERE "chapterId" = ${candidate.chapterId} ORDER BY "id" FOR SHARE`;
    const chapter = await tx.chapter.findUnique({ where: { id: candidate.chapterId! }, include: { book: { include: { contentCollection: true } }, verses: { orderBy: { number: "asc" } } } });
    if (!chapter || chapter.book.contentCollectionId !== candidate.collectionId || chapterSourceHash(chapter) !== candidate.sourceHash) throw new Error("SOURCE_MISMATCH");
    const c = chapter.book.contentCollection;
    if (c.work !== candidate.work || c.editionKey !== candidate.editionKey || c.language !== candidate.language) throw new Error("SOURCE_MISMATCH");
    validateSegments(segmentsSchema.shape.segments.parse(candidate.segments), chapter.verses, candidate.duration);
    if(conversion){const task=await tx.officialAudioTask.findFirstOrThrow({where:{recordingId:candidate.id}});await assertLegacyBaseline(tx,officialSource(task.id)!);}
    const current = await tx.audioPublication.findUnique({ where: { targetKey: candidate.targetKey } });
    // De officiële bulkbediening mag nooit een bestaande publicatie vervangen, ook niet bij een race.
    if((options.onlyIfUnpublished||conversion)&&current) {
      if(current.recordingId===recordingId)return current;
      throw Error("PUBLICATION_CONFLICT");
    }
    if ((current?.version ?? 0) !== expectedVersion) throw new Error("PUBLICATION_CONFLICT");
    if (current?.recordingId === recordingId) return current;
    return tx.audioPublication.upsert({ where: { targetKey: candidate.targetKey }, create: { targetKey: candidate.targetKey, recordingId, publishedBy: actor.id }, update: { recordingId, publishedBy: actor.id, publishedAt: new Date(), version: { increment: 1 } } });
  });
}
export async function activeChapterAudio(chapter: { id: string; heading: string | null; verses: { id: string; number: number; text: string; audioStart: number | null }[] }, db: DB = prisma) {
  const pointer = await db.audioPublication.findUnique({ where: { targetKey: `chapter:${chapter.id}` }, include: { recording: true } });
  if (!pointer) return undefined; // Legacy blijft onaangetast als er geen nieuwe publicatie bestaat.
  const recording = pointer.recording;
  const anchor = await db.chapter.findUnique({ where: { id: chapter.id }, select: { book: { select: { contentCollectionId: true } } } });
  if (anchor?.book.contentCollectionId !== recording.collectionId) return null;
  if (recording.sourceHash !== chapterSourceHash(chapter)) return await legacyFallback(chapter.id,db) ? undefined : null; // Alleen een exact gelijk gebleven legacy-uitgave mag terugvallen; gewijzigde tekst krijgt TTS.
  try {
    const segments = segmentsSchema.shape.segments.parse(recording.segments);
    validateSegments(segments, chapter.verses, recording.duration);
    await verifyObject(recording.sha256, recording.byteSize);
    return { url: `/api/audio/recordings/${recording.id}`, legacyFallback:await legacyFallback(chapter.id,db), verses: chapter.verses.map((v, i) => ({ number: v.number, text: v.text, audioStart: segments[i].start })) };
  } catch { return await legacyFallback(chapter.id,db) ? undefined : null; }
}
export async function accessibleRecording(actor: ContentActor, id: string, db: DB = prisma, preview = false) {
  if (preview && actor.isAdmin) {
    const recording = await db.audioRecording.findFirst({ where: { id, collection: collectionAccessWhere(actor, "admin-preview") } });
    if (!recording?.chapterId) return null;
    const chapter = await db.chapter.findUnique({ where: { id: recording.chapterId }, include: { book: { select: { contentCollectionId: true } }, verses: { orderBy: { number: "asc" } } } });
    if (!chapter || chapter.book.contentCollectionId !== recording.collectionId || chapterSourceHash(chapter) !== recording.sourceHash) return null;
    try {
      const segments = segmentsSchema.shape.segments.parse(recording.segments);
      if (segments.length || (recording.quality as { status?: string }).status !== "NEEDS_REVIEW") validateSegments(segments, chapter.verses, recording.duration);
      return recording;
    }
    catch { return null; }
  }
  const pointer = await db.audioPublication.findFirst({ where: { recordingId: id, recording: { collection: readingAccessWhere(actor) } }, include: { recording: true } });
  if (!pointer?.recording.chapterId) return null;
  const chapter = await db.chapter.findUnique({ where: { id: pointer.recording.chapterId }, include: { book: { select: { contentCollectionId: true } }, verses: { orderBy: { number: "asc" } } } });
  if (!chapter || chapter.book.contentCollectionId !== pointer.recording.collectionId || chapterSourceHash(chapter) !== pointer.recording.sourceHash) return null;
  try { validateSegments(segmentsSchema.shape.segments.parse(pointer.recording.segments), chapter.verses, pointer.recording.duration); return pointer.recording; }
  catch { return null; }
}
// Overzicht blijft bij bestaande collectie-/hoofdstukidentiteiten; geen parallelle contentcatalogus.
export async function audioOverview(db: PrismaClient = prisma) {
  const collections = await db.contentCollection.findMany({ where: { work: { in: ["bofm", "dc-testament", "pgp"] } }, include: { books: { select: { chapters: { select: { id: true, audioUrl: true } } } }, recordings: { select: { id: true, chapterId: true, chapter: { select: { number: true, book: { select: { name: true } } } }, targetKey: true, sourceKind: true, quality: true, sha256: true, byteSize: true, voice: true, sourceMetadata: true, publication: true, package: { select: { status: true, errorCode: true } } } } }, orderBy: [{ work: "asc" }, { language: "asc" }] });
  const errors = await db.audioPackage.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, errorCode: true, attempts: true, updatedAt: true } });
  const root = audioDir();
  const localLegacy = new Set(root ? await fs.readdir(root).catch(() => [] as string[]) : []);
  const localObjects = new Set(root ? await fs.readdir(path.join(root, "objects")).catch(() => [] as string[]) : []);
  return { collections: collections.map(({ books, recordings, ...c }) => {
    const chapters = books.flatMap((b) => b.chapters), total = chapters.length;
    const legacy = chapters.filter((ch) => ch.audioUrl);
    const available = new Set([...legacy.map((ch) => ch.id), ...recordings.flatMap((r) => r.chapterId ? [r.chapterId] : [])]).size;
    const hashes = new Map(recordings.map((r) => [r.sha256, r.byteSize]));
    const local = new Set([...legacy.filter((ch) => localLegacy.has(mirrorFileName(ch.audioUrl!) ?? "")).map((ch) => ch.id), ...recordings.filter((r) => localObjects.has(r.sha256 + ".mp3")).flatMap((r) => r.chapterId ? [r.chapterId] : [])]).size;
    return { ...c, total, available, missing: total - available, local, legacy: legacy.length, registered: recordings.length, bytes: [...hashes.values()].reduce((a, b) => a + b, 0), recordings };
  }), errors };
}

export type AudioOverview = Awaited<ReturnType<typeof audioOverview>>;
