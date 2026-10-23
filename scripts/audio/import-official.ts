/** Expliciete lokale/NAS-beheeropdracht; gebruikt dezelfde ontvanger, publiceert nooit. */
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../src/lib/db";
import { ensureHiddenAudioTextEditions } from "../../src/lib/audio/hiddenEditions";
import { chapterSourceHash, sha256 } from "../../src/lib/audio/contract";
import { audioRoot, safeDirectory } from "../../src/lib/audio/storage";
import { importAudioPackage } from "../../src/lib/audio/library";
const root = path.resolve(process.argv[2] ?? ".audio-v2-work");
const db = createPrismaClient();
const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value));
try {
  await ensureHiddenAudioTextEditions(db);
  const inventory = JSON.parse(await fs.readFile(path.join(root, "inventory.json"), "utf8"));
  const incoming = await safeDirectory(await audioRoot(), "incoming", true);
  const pinned = await fs.readFile(path.resolve("data/audio/official-alignments.json"), "utf8").then(JSON.parse).catch(() => ({ recordings: {} }));
  let imported = 0, missingAlignment = 0, mismatched = 0, failed = 0;
  for (const row of inventory.chapters) {
    const collection = await db.contentCollection.findUnique({ where: { work_editionKey_language: { work: row.work, editionKey: row.editionKey, language: row.language } } });
    if (!collection) { mismatched++; continue; }
    const collectionId = collection.id;
    const chapter = await db.chapter.findFirst({ where: { number: row.chapterNumber, book: { key: row.bookKey, contentCollectionId: collectionId } }, include: { verses: { orderBy: { number: "asc" } } } });
    if (!chapter) { mismatched++; continue; }
    const pageHash = row.sourceHash ?? row.sourcePageHash;
    if (chapterSourceHash(chapter) !== pageHash) { mismatched++; continue; }
    for (const recording of row.recordings) {
      if (recording.status !== "DOWNLOADED_VALIDATED") continue;
      if (!/^audio\/[a-f0-9]{64}\.mp3$/.test(recording.localFile ?? "")) throw new Error("Ongeldig lokaal bronpad in inventaris.");
      let alignment = await fs.readFile(path.join(root, "alignment", `${recording.sha256}-${pageHash}.json`), "utf8").then(JSON.parse).catch(() => pinned.recordings?.[`${recording.sha256}-${pageHash}`] ?? null);
      if (!alignment || alignment.sourceHash !== pageHash || alignment.sha256 !== recording.sha256 || Math.abs(alignment.duration - recording.duration) > 0.15 || alignment.starts.length !== chapter.verses.length) {
        missingAlignment++;
        const error = await fs.readFile(path.join(root, "alignment", `${recording.sha256}-${pageHash}.error.json`), "utf8").then(JSON.parse).catch(() => null);
        alignment = { schemaVersion: 1, sourceHash: pageHash, sha256: recording.sha256, sourceUrl: recording.url, duration: recording.duration, starts: [], quality: "NEEDS_REVIEW", method: "ALIGNMENT_REQUIRED", error: error?.error ?? "NO_VALID_ALIGNMENT" };
      }
      const segmentBytes = jsonBytes({ schemaVersion: 1, segments: alignment.starts.length ? chapter.verses.map((v, i) => ({ id: v.id, kind: "VERSE", sourceHash: sha256(v.text), start: alignment.starts[i], end: alignment.starts[i + 1] ?? recording.duration })) : [] });
      const reportBytes = jsonBytes(alignment);
      const manifest = { schemaVersion: 1, packageId: "pending", collectionId, work: row.work, editionKey: row.editionKey, language: row.language, target: { kind: "CHAPTER", bookKey: row.bookKey, chapterNumber: row.chapterNumber }, sourceHash: pageHash, sourceKind: "OFFICIAL", source: { name: "The Church of Jesus Christ of Latter-day Saints", url: recording.url, checkedAt: recording.checkedAt, rights: "Officiële opname; bestaande bronvoorwaarden blijven van toepassing. Geen openbare audiomirror." }, voice: { name: recording.voice || "official" }, audio: { file: "audio.mp3", sha256: recording.sha256, bytes: recording.bytes, duration: recording.duration, format: "mp3" }, segments: { file: "segments.json", sha256: sha256(segmentBytes) }, quality: alignment.quality, qualityReport: { file: "quality-report.json", sha256: sha256(reportBytes) } };
      const id = `official-${sha256(jsonBytes(manifest)).slice(0, 48)}`;
      manifest.packageId = id;
      const folder = path.join(incoming, id);
      try {
        await fs.access(folder);
      } catch {
        const staging = await safeDirectory(await audioRoot(), "staging", true);
        const stage = await safeDirectory(staging, `stage-${randomUUID()}`, true);
        await fs.link(path.join(root, recording.localFile), path.join(stage, "audio.mp3")).catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== "EXDEV") throw error;
          await fs.copyFile(path.join(root, recording.localFile), path.join(stage, "audio.mp3"));
        });
        await fs.writeFile(path.join(stage, "segments.json"), segmentBytes);
        await fs.writeFile(path.join(stage, "quality-report.json"), reportBytes);
        await fs.writeFile(path.join(stage, "manifest.json"), jsonBytes(manifest));
        await fs.writeFile(path.join(stage, "READY"), "1\n");
        for (const name of ["audio.mp3", "segments.json", "quality-report.json", "manifest.json", "READY"]) {
          const handle = await fs.open(path.join(stage, name), "r");
          try { await handle.sync(); } finally { await handle.close(); }
        }
        const staged = await fs.open(stage, "r");
        try { await staged.sync(); } finally { await staged.close(); }
        await fs.rename(stage, folder);
        const parent = await fs.open(incoming, "r");
        try { await parent.sync(); } finally { await parent.close(); }
      }
      const result = await importAudioPackage(folder, db);
      if (result.status === "READY") imported++;
      else { failed++; console.error(id, result.status, result.errorCode); }
      if ((imported + failed) % 100 === 0) console.log({ imported, missingAlignment, mismatched });
    }
  }
  console.log({ imported, missingAlignment, mismatched, failed, published: 0 });
  if (failed || mismatched) process.exitCode = 1;
} finally { await db.$disconnect(); }
