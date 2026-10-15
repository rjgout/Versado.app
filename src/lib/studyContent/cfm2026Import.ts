import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import sourceLock from "../../../data/study-content/cfm-2026-nl/source-lock.json";
import mediaLock from "../../../data/study-content/cfm-2026-nl/media-lock.json";
import { cfmOldTestament2026NlManifest as manifest } from "./cfm2026Manifest";
import {
  CFM_ADAPTER,
  cfmSourceHash,
  parseCfmLesson,
  cfmSnapshotItem,
  type CfmMedia,
  type CfmSource,
} from "./cfm2026Adapter";
import {
  registerStudySnapshotImport,
  executeStudyImport,
  lockStudyImportScope,
} from "./imports";
import {
  requireStudyAdmin,
  type StudyAdmin,
  StudyPublishingError,
} from "./policy";
import { downloadStudyImage } from "./download";
import { studyStorage, validateStudyImage } from "./storage";

export async function loadCfmLesson(key: string) {
  if (!manifest.lessons.some((l) => l.sourceKey === key))
    throw Error("CFM_LESSON_KEY");
  const raw = await fs.readFile(
    path.join(
      process.cwd(),
      "data/study-content/cfm-2026-nl/source",
      `${key}.json`,
    ),
    "utf8",
  );
  const expected = sourceLock.lessons[key as keyof typeof sourceLock.lessons];
  if (cfmSourceHash(raw) !== expected) throw Error("CFM_SOURCE_HASH");
  return parseCfmLesson(key, JSON.parse(raw) as CfmSource, mediaLock);
}
/** Geen voorkeur-/publicatie-/voortgangsmutaties. Bestaande collectie-ID's en flags blijven intact. */
export async function ensureCfmDraftCollection(
  actor: StudyAdmin,
  client: PrismaClient = prisma,
) {
  requireStudyAdmin(actor);
  return client.$transaction(async (db) => {
    await lockStudyImportScope(db, `cfm-2026-catalogue`);
    const existingWork = await db.contentWork.findUnique({
      where: { key: manifest.workKey },
    });
    if (existingWork && existingWork.kind !== "STUDY_PROGRAM")
      throw new StudyPublishingError("INVALID");
    await db.contentWork.upsert({
      where: { key: manifest.workKey },
      update: {},
      create: { key: manifest.workKey, kind: "STUDY_PROGRAM" },
    });
    const existing = await db.contentCollection.findFirst({
      where: {
        work: manifest.workKey,
        editionKey: manifest.editionKey,
        language: manifest.language,
      },
    });
    return (
      existing ??
      db.contentCollection.create({
        data: {
          id: "content_cfm_ot_2026_nl",
          slug: "cfm-ot-2026-nl",
          name: "Kom dan en volg Mij 2026 — Oude Testament",
          icon: "",
          work: manifest.workKey,
          editionKey: manifest.editionKey,
          language: manifest.language,
          enabled: true,
          visibleToUsers: false,
          publicationState: "DRAFT",
          sourceName: "The Church of Jesus Christ of Latter-day Saints",
          sourceUrl: manifest.canonicalUrl,
        },
      })
    );
  });
}
/** De downloadcallback bestaat voor netwerkloze geïsoleerde tests; geen clientpayload. */
export async function importCfm2026Drafts(
  actor: StudyAdmin,
  options: {
    mediaBytes?: (asset: CfmMedia) => Promise<Buffer>;
    client?: PrismaClient;
  } = {},
) {
  requireStudyAdmin(actor);
  await studyStorage();
  const client = options.client ?? prisma;
  // Valideer alle 52 bronnen vóór de eerste databasewrite.
  const lessons = await Promise.all(
    manifest.lessons.map((l) => loadCfmLesson(l.sourceKey)),
  );
  const collection = await ensureCfmDraftCollection(actor, client);
  const cache = new Map<string, Buffer>();
  const report = [];
  for (const parsed of lessons) {
    for (const asset of parsed.assets) {
      if (cache.has(asset.checksum)) continue;
      const bytes = options.mediaBytes
        ? await options.mediaBytes(asset)
        : (
            await downloadStudyImage(
              asset.url,
              { allowedHosts: ["www.churchofjesuschrist.org"] },
              asset.checksum,
            )
          ).bytes;
      const checked = await validateStudyImage(
        bytes,
        asset.mimeType,
        asset.checksum,
      );
      if (
        checked.width !== asset.width ||
        checked.height !== asset.height ||
        checked.byteSize !== asset.byteSize
      )
        throw new StudyPublishingError("MEDIA");
      cache.set(asset.checksum, bytes);
    }
    const item = cfmSnapshotItem(parsed, (a) => cache.get(a.checksum)!);
    item.startsOn = parsed.lesson.startsOn;
    item.endsOn = parsed.lesson.endsOn;
    const run = await registerStudySnapshotImport(
      actor,
      collection.id,
      {
        workKey: manifest.workKey,
        editionKey: manifest.editionKey,
        language: "nl",
        adapterName: CFM_ADAPTER,
        adapterVersion: "1",
        synthetic: false,
        sourceVersion:
          sourceLock.lessons[
            parsed.lesson.sourceKey as keyof typeof sourceLock.lessons
          ],
        period: {
          sourceKey: parsed.lesson.periodSourceKey,
          label: `${parsed.lesson.startsOn} — ${parsed.lesson.endsOn}`,
          year: manifest.year,
        },
        items: [item],
      },
      client,
    );
    await executeStudyImport(actor, run.id, client);
    const imported = await client.contentImportItem.findFirstOrThrow({
      where: { runId: run.id },
      include: { revision: { include: { references: true } } },
    });
    report.push({
      lessonKey: parsed.lesson.sourceKey,
      runId: run.id,
      editionId: imported.lessonEditionId,
      revisionId: imported.revisionId,
      blocks: parsed.inventory.blockCount,
      references: imported.revision.references.map((r) => ({
        anchor: r.occurrenceKey,
        label: r.label,
        diagnosis: r.diagnosis,
        target: r.originalTarget,
        normalized: r.normalizedTarget,
      })),
      diagnostics: parsed.diagnostics,
      media: parsed.assets.length,
    });
  }
  return {
    expectedLessons: 52,
    importedLessons: report.length,
    collectionId: collection.id,
    publicationChanged: false,
    lessons: report,
  };
}
