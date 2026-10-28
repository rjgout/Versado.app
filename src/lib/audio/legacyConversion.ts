import { constants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { mirrorFileName, playableAudioUrl } from "@/lib/audioMirror";
import { chapterSourceHash, objectHash } from "./contract";
import { officialSources, type OfficialSource } from "./officialCatalogue";
import { audioRoot } from "./storage";

// Vastgepinde korte, middellange en lange bestaande legacy-hoofdstukken. Geen dynamische selectie.
export const LEGACY_PILOT_IDS = [
  "15e98edea75885a3babb27e7123ceda35945a0175c22ac2fbb357240570adc76", // 2 Nephi 22, 6 verzen, 68 s
  "ed5800214d909cd2bf0f051611840449af6845d224f3bfe5b5ee4b46e87cf09b", // 1 Nephi 21, 26 verzen, 434 s
  "e83065189d4fdbe535b612fb8e86fc427aad79257bef9ed79e425d7aed493722", // Jakob 5, 77 verzen, 1315 s
] as const;
export const legacySources = officialSources.filter(s => s.legacyProtected && s.language === "nl" && s.work === "bofm" && s.editionKey === "bofm");
const baselineSchema = z.object({
  schemaVersion: z.literal(1), sourceId: z.string(), chapterId: z.string(), audioUrl: z.string(), sourceHash: z.string(),
  audioHeadingStart:z.number().nullable(), audioHeadingEnd:z.number().nullable(),
  audioCheck:z.object({status:z.string(),textHash:z.string(),pendingHash:z.string().nullable()}).strict().nullable(),
  verseStarts: z.array(z.object({ id: z.string(), number: z.number(), audioStart: z.number().nullable() }).strict()),
  file: z.object({ name: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive() }).strict().nullable(),
}).strict();
export type LegacyBaseline = z.infer<typeof baselineSchema>;
type DB = PrismaClient | Prisma.TransactionClient;
export function assertLegacySource(source: OfficialSource) {
  if (!legacySources.some(s => s.id === source.id) || !source.legacyProtected || source.work !== "bofm" || source.language !== "nl" || source.editionKey !== "bofm" || source.quality !== "VALIDATED") throw Error("SOURCE_PROTECTED");
}
async function legacyChapter(source: OfficialSource, db: DB) {
  const chapter = await db.chapter.findFirst({ where: { number: source.chapterNumber, book: { key: source.bookKey, contentCollection: { work: "bofm", editionKey: source.editionKey, language: "nl" } } }, include: { verses: { orderBy: { number: "asc" } }, book: true, audioCheck:true } });
  if (!chapter || !chapter.audioUrl) throw Error("LEGACY_BASELINE_MISSING");
  if(chapter.audioCheck?.status==="NEEDS_REVIEW")throw Error("LEGACY_BASELINE_CHANGED");
  if (chapterSourceHash(chapter) !== source.sourceHash || chapter.verses.length !== source.verses) throw Error("SOURCE_MISMATCH");
  return chapter;
}
function core(source: OfficialSource, chapter: Awaited<ReturnType<typeof legacyChapter>>) {
  return { schemaVersion: 1 as const, sourceId: source.id, chapterId: chapter.id, audioUrl: chapter.audioUrl!, sourceHash: chapterSourceHash(chapter), audioHeadingStart:chapter.audioHeadingStart,audioHeadingEnd:chapter.audioHeadingEnd,audioCheck:chapter.audioCheck?{status:chapter.audioCheck.status,textHash:chapter.audioCheck.textHash,pendingHash:chapter.audioCheck.pendingHash}:null, verseStarts: chapter.verses.map(({ id, number, audioStart }) => ({ id, number, audioStart })) };
}
async function fingerprint(name: string) {
  const handle = await fs.open(path.join(await audioRoot(), name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > 256 * 1024 * 1024) throw Error("LEGACY_FILE_UNSAFE");
    let bytes = 0; const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > before.size) throw Error("LEGACY_BASELINE_CHANGED"); hash.update(chunk); }
    const after = await handle.stat();
    if (before.size !== bytes || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw Error("LEGACY_BASELINE_CHANGED");
    return { name, bytes, sha256: hash.digest("hex") };
  } finally { await handle.close(); }
}
/** Alleen lezen; maximaal drie volledige legacy-bestandshashes per beheerbesluit. */
export async function prepareLegacyConversion(ids: string[], db: PrismaClient = prisma) {
  if (!ids.length || ids.length > 3 || new Set(ids).size !== ids.length) throw Error("INVALID_ACTION");
  const baselines: LegacyBaseline[] = [];
  for (const id of [...ids].sort()) {
    const source = legacySources.find(s => s.id === id); if (!source) throw Error("SOURCE_PROTECTED"); assertLegacySource(source);
    const chapter = await legacyChapter(source, db), name = mirrorFileName(chapter.audioUrl!);
    if (!name) throw Error("LEGACY_BASELINE_MISSING");
    let file: LegacyBaseline["file"] = null;
    try { file = await fingerprint(name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    baselines.push({ ...core(source, chapter), file });
  }
  return { baselines, planHash: objectHash(baselines) };
}
/** Geen bestand-I/O binnen locks. De bewaarde bron, tekst en alle oude tijdcodes moeten exact gelijk blijven. */
export async function assertLegacyBaseline(db: DB, source: OfficialSource) {
  assertLegacySource(source);
  const task = await db.officialAudioTask.findUnique({ where: { id: source.id } });
  const parsed = baselineSchema.safeParse(task?.legacyBaseline);
  if (!task?.legacyApprovedAt || !parsed.success) throw Error("LEGACY_BASELINE_MISSING");
  if (objectHash(parsed.data) !== objectHash({ ...core(source, await legacyChapter(source, db)), file:parsed.data.file })) throw Error("LEGACY_BASELINE_CHANGED");
  return parsed.data;
}
export async function legacyPilotApproved(db: DB) {
  const tasks = await db.officialAudioTask.findMany({ where: { id: { in: [...LEGACY_PILOT_IDS] } } });
  if (tasks.length !== 3 || tasks.some(t => t.status!=="REGISTERED" || !t.recordingId || !t.legacyAcceptanceKey || !t.legacyAcceptedAt)) return false;
  const key = objectHash(tasks.sort((a,b) => a.id.localeCompare(b.id)).map(t => ({ id:t.id, recordingId:t.recordingId, baseline:t.legacyBaseline })));
  if (tasks.some(t => t.legacyAcceptanceKey !== key)) return false;
  if (await db.audioPublication.count({ where: { recordingId: { in: tasks.map(t => t.recordingId!) } } }) !== 3) return false;
  try { for (const task of tasks) await assertLegacyBaseline(db, legacySources.find(s => s.id === task.id)!); } catch { return false; }
  return true;
}
export async function assertLegacyAllowed(db: DB, source: OfficialSource) {
  await assertLegacyBaseline(db, source);
  if (!(LEGACY_PILOT_IDS as readonly string[]).includes(source.id) && !await legacyPilotApproved(db)) throw Error("LEGACY_PILOT_REQUIRED");
}
export async function legacyInventory(db: PrismaClient = prisma) {
  const chapters = await db.chapter.findMany({ where: { book: { contentCollection: { work: "bofm", editionKey: "bofm", language: "nl" } } }, include: { book: true, audioCheck:true, verses: { orderBy: { number: "asc" } } } });
  const tasks = await db.officialAudioTask.findMany({ where: { id: { in: legacySources.map(s => s.id) } } });
  const publications=await db.audioPublication.findMany({where:{targetKey:{in:chapters.map(c=>`chapter:${c.id}`)}}});
  const rows = [];
  for (const source of legacySources) {
    const chapter = chapters.find(c => c.book.key === source.bookKey && c.number === source.chapterNumber), task = tasks.find(t => t.id === source.id);
    let filePresent = false; const name = chapter?.audioUrl ? mirrorFileName(chapter.audioUrl) : null;
    if (name) try { const stat = await fs.lstat(path.join(await audioRoot(), name)); filePresent = stat.isFile() && stat.size > 0; } catch { /* Zichtbaar als ontbrekend; GET schrijft niets. */ }
    rows.push({ id:source.id, bookName:chapter?.book.name ?? source.bookKey, bookKey:source.bookKey, chapterNumber:source.chapterNumber, duration:source.duration, bytes:source.bytes, sha256:source.sha256, sourceHash:source.sourceHash, url:source.url, legacyUrl:chapter?.audioUrl ?? null, filePresent, verseStarts:chapter?.verses.map(({ number,audioStart }) => ({ number,audioStart })) ?? [], textMatches:!!chapter && chapter.audioCheck?.status!=="NEEDS_REVIEW" && chapterSourceHash(chapter) === source.sourceHash, review:source.quality !== "VALIDATED", pilot:(LEGACY_PILOT_IDS as readonly string[]).includes(source.id), published:!!task?.recordingId&&publications.some(p=>p.recordingId===task.recordingId), occupied:!!chapter&&publications.some(p=>p.targetKey===`chapter:${chapter.id}`), status:task?.status ?? "NOT_CHECKED", recordingId:task?.recordingId ?? null, baseline:task?.legacyBaseline ?? null, errorCode:task?.errorCode ?? null });
  }
  return { rows, pilotApproved:await legacyPilotApproved(db) };
}
/** Alleen een ongewijzigde conversie-uitgangssituatie mag de legacy-speler herstellen. */
export async function legacyFallback(chapterId: string, db: DB = prisma) {
  const task = await db.officialAudioTask.findFirst({ where: { legacyApprovedAt: { not:null }, recording: { chapterId } } });
  const source = task && legacySources.find(s => s.id === task.id); if (!source) return null;
  try {
    const baseline = await assertLegacyBaseline(db, source);
    if (baseline.file && objectHash(await fingerprint(baseline.file.name)) !== objectHash(baseline.file)) return null;
    return { url:baseline.file?playableAudioUrl(baseline.audioUrl):baseline.audioUrl, starts:baseline.verseStarts };
  } catch { return null; }
}
