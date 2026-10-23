import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ensureCfmCourses } from "./cfmCourses";
import { CFM_SOURCE_2026, CFM_SOURCES, type CfmMedia, type CfmSource, type CfmVolumeSource } from "./cfmSources";
import {
  cfmSourceHash,
  parseCfmLesson,
  cfmSnapshotItem,
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
import {
  studyStorage,
  validateStudyImage,
  readStudyMedia,
  installStudyMedia,
} from "./storage";

/** Leest één gepinde bronles van een jaargang; een afwijkende hash is een harde fout (nooit stilzwijgend importeren). */
export async function loadCfmLesson(key: string, volume: CfmVolumeSource = CFM_SOURCE_2026) {
  if (!volume.manifest.lessons.some((l) => l.sourceKey === key))
    throw Error("CFM_LESSON_KEY");
  const raw = await fs.readFile(
    path.join(process.cwd(), volume.dataDir, "source", `${key}.json`),
    "utf8",
  );
  const expected = volume.sourceLock.lessons[key];
  if (!expected || cfmSourceHash(raw) !== expected) throw Error("CFM_SOURCE_HASH");
  return parseCfmLesson(key, JSON.parse(raw) as CfmSource, volume.mediaLock, volume);
}
/** Geen voorkeur-/publicatie-/voortgangsmutaties. Bestaande collectie-ID's en flags blijven intact. */
export async function ensureCfmDraftCollection(
  actor: StudyAdmin,
  client: PrismaClient = prisma,
  volume: CfmVolumeSource = CFM_SOURCE_2026,
) {
  requireStudyAdmin(actor);
  const manifest = volume.manifest;
  return client.$transaction(async (db) => {
    await lockStudyImportScope(db, `cfm-${volume.volume.year}-catalogue`);
    const existingWork = await db.contentWork.findUnique({
      where: { key: manifest.workKey },
    });
    if (existingWork && existingWork.kind !== "STUDY_PROGRAM")
      throw new StudyPublishingError("INVALID");
    const existing = await db.contentCollection.findFirst({
      where: {
        work: manifest.workKey,
        editionKey: manifest.editionKey,
        language: manifest.language,
      },
    });
    // Updates maken uitsluitend concepten; bestaande publicatie en zichtbaarheid blijven intact.
    if (
      existing &&
      (existing.work !== manifest.workKey ||
        existing.editionKey !== manifest.editionKey ||
        existing.language !== manifest.language)
    )
      throw new StudyPublishingError("CONFLICT");
    await db.contentWork.upsert({
      where: { key: manifest.workKey },
      update: {},
      create: { key: manifest.workKey, kind: "STUDY_PROGRAM" },
    });
    const collection =
      existing ??
      (await db.contentCollection.create({
        data: {
          id: volume.volume.collectionId,
          slug: volume.volume.collectionSlug,
          name: volume.collectionName,
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
      }));
    // De leescursussen (Stap voor stap, Vrije studie) horen bij de collectie; nooit ingeschreven of zichtbaar gemaakt.
    await ensureCfmCourses(db, collection);
    return collection;
  });
}
export interface CfmImportOptions {
  mediaBytes?: (asset: CfmMedia) => Promise<Buffer>;
  client?: PrismaClient;
  progress?: (current: number, total: number, label: string) => void;
}
/**
 * De generieke conceptimport van één jaargang. De downloadcallback bestaat voor netwerkloze geïsoleerde tests; geen
 * clientpayload. Publiceert nooit zelf: automatische publicatie is een aparte, expliciete stap (cfmAutoPublish.ts).
 */
export async function importCfmDrafts(
  actor: StudyAdmin,
  volume: CfmVolumeSource,
  options: CfmImportOptions = {},
) {
  requireStudyAdmin(actor);
  const { manifest, mediaLock, sourceLock } = volume;
  const store = await studyStorage();
  const unique = new Map(mediaLock.map((asset) => [asset.checksum, asset]));
  const space = await fs.statfs(store.root);
  const required =
    [...unique.values()].reduce((sum, a) => sum + a.byteSize, 0) +
    32 * 1024 * 1024;
  if (Number(space.bavail) * Number(space.bsize) < required)
    throw new StudyPublishingError("STORAGE");
  const client = options.client ?? prisma;
  // Valideer alle bronnen vóór de eerste databasewrite.
  const lessons = await Promise.all(
    manifest.lessons.map((l) => loadCfmLesson(l.sourceKey, volume)),
  );
  const collection = await ensureCfmDraftCollection(actor, client, volume);
  const cache = new Map<string, Buffer>();
  const report = [];
  for (const parsed of lessons) {
    options.progress?.(report.length, lessons.length, parsed.title);
    for (const asset of parsed.assets) {
      if (cache.has(asset.checksum)) continue;
      const stored = await client.contentMedia.findUnique({
        where: { checksum: asset.checksum },
      });
      let bytes: Buffer | undefined;
      let repair = false;
      if (stored?.status === "READY")
        try {
          bytes = await readStudyMedia(stored, true);
        } catch (error) {
          if (
            !(error instanceof StudyPublishingError) ||
            error.code !== "MEDIA"
          )
            throw error;
          repair = true;
        }
      bytes ??= options.mediaBytes
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
      if (repair) await installStudyMedia(bytes, checked);
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
        adapterName: volume.adapter,
        adapterVersion: "2",
        synthetic: false,
        sourceVersion: sourceLock.lessons[parsed.lesson.sourceKey],
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
  options.progress?.(report.length, lessons.length, `CFM ${volume.volume.year}`);
  return {
    expectedLessons: manifest.lessons.length,
    importedLessons: report.length,
    collectionId: collection.id,
    publicationChanged: false,
    lessons: report,
  };
}

/** De bestaande 2026-ingang blijft bestaan (scripts, tests, beheerreeks); dezelfde generieke import eronder. */
export function importCfm2026Drafts(actor: StudyAdmin, options: CfmImportOptions = {}) {
  return importCfmDrafts(actor, CFM_SOURCE_2026, options);
}

/**
 * Alle geregistreerde jaargangen met een gepinde bron, chronologisch en één voor één (elke jaargang is zelf idempotent en
 * hervatbaar). Een mislukte jaargang stopt de volgende niet stilzwijgend: de fout wordt meegegeven en de rest loopt door.
 */
export async function importAllCfmDrafts(actor: StudyAdmin, options: CfmImportOptions & { onVolume?: (volume: CfmVolumeSource) => void } = {}) {
  const results: Array<{ year: number; ok: true; report: Awaited<ReturnType<typeof importCfmDrafts>> } | { year: number; ok: false; error: unknown }> = [];
  // Noodstop/testbeperking: CFM_IMPORT_YEARS=2026 beperkt de reeks tot die jaargangen (standaard alle geregistreerde).
  const only = process.env.CFM_IMPORT_YEARS?.split(",").map((y) => Number(y.trim())).filter(Number.isInteger);
  for (const volume of CFM_SOURCES.filter((v) => !only?.length || only.includes(v.volume.year))) {
    options.onVolume?.(volume);
    try {
      results.push({ year: volume.volume.year, ok: true, report: await importCfmDrafts(actor, volume, options) });
    } catch (error) {
      results.push({ year: volume.volume.year, ok: false, error });
    }
  }
  return results;
}
