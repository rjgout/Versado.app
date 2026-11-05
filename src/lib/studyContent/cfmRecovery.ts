import type { PrismaClient } from "@/generated/prisma/client";
import { CFM_SOURCE_2026 } from "./cfmSources";
import { CFM_MEDIA_CANDIDATES } from "./cfmMedia";
import { loadCfmLesson } from "./cfm2026Import";
import { findOriginalCfmBytes, restoreOriginalCfmFile } from "./originalMedia";
import { readStudyMedia, validateStudyImage } from "./storage";
import { cfmApprovedSnapshot } from "./sourceApproval";
import {
  requireStudyAdmin,
  StudyPublishingError,
  studyObjectHash,
  type StudyAdmin,
} from "./policy";

/** Alleen op expliciet verzoek, niet in de gewone beheerpoll. Geen downloads of opslagmutaties. */
export async function cfmRecoveryPlan(actor: StudyAdmin, client: PrismaClient) {
  requireStudyAdmin(actor);
  const source = CFM_SOURCE_2026;
  const approvedSnapshot = await cfmApprovedSnapshot();
  const editions = await client.studyLessonEdition.findMany({
    where: { collectionId: source.volume.collectionId },
    select: {
      id: true,
      publishedRevisionId: true,
      draftRevisionId: true,
      publicationVersion: true,
      lesson: { select: { sourceKey: true, retiredAt: true } },
    },
    orderBy: { id: "asc" },
  });
  const lessons = await Promise.all(
    source.manifest.lessons.map((l) => loadCfmLesson(l.sourceKey, source)),
  );
  const assets = [];
  for (const candidate of CFM_MEDIA_CANDIDATES) {
    const pin = source.mediaLock.find(
      (a) =>
        a.url === candidate.url &&
        a.checksum === candidate.originalChecksum &&
        a.byteSize === candidate.originalBytes,
    );
    if (!pin) throw new StudyPublishingError("CONFLICT");
    const record = await client.contentMedia.findUnique({
      where: { checksum: pin.checksum },
    });
    let volumeValid = false;
    if (record?.status === "READY") {
      try {
        const v = await validateStudyImage(
          await readStudyMedia(record, true),
          pin.mimeType,
          pin.checksum,
        );
        volumeValid =
          v.byteSize === pin.byteSize &&
          v.width === pin.width &&
          v.height === pin.height;
      } catch (e) {
        if (!(e instanceof StudyPublishingError) || e.code !== "MEDIA") throw e;
      }
    }
    const original = volumeValid
      ? null
      : await findOriginalCfmBytes(client, pin);
    assets.push({
      ...candidate,
      lessonKeys: lessons
        .filter((l) => l.assets.some((a) => a.url === pin.url))
        .map((l) => l.lesson.sourceKey),
      mediaId: record?.id ?? null,
      status: volumeValid
        ? ("ORIGINAL_VALID" as const)
        : original
          ? ("ORIGINAL_SNAPSHOT" as const)
          : ("REVIEW_REQUIRED" as const),
      snapshotRunId: original?.runId ?? null,
    });
  }
  const revisionKeys = [
    ...new Set(
      assets
        .filter((a) => a.status === "REVIEW_REQUIRED")
        .flatMap((a) => a.lessonKeys),
    ),
  ]
    .filter((key) =>
      editions.some(
        (e) =>
          e.lesson.sourceKey === key &&
          !e.lesson.retiredAt &&
          (e.publishedRevisionId || e.draftRevisionId),
      ),
    )
    .sort();
  const planHash = studyObjectHash({
    actor: actor.id,
    approvedSnapshot,
    editions,
    assets,
    revisionKeys,
  });
  return {
    planHash,
    approvedSnapshot,
    assets,
    revisionKeys,
    requiresMediaReview: assets.some((a) => a.status === "REVIEW_REQUIRED"),
    importedLessons: editions.length,
    publishedLessons: editions.filter((e) => e.publishedRevisionId).length,
    expectedLessons: source.manifest.lessons.length,
  };
}
export type CfmRecoveryPlan = Awaited<ReturnType<typeof cfmRecoveryPlan>>;

/** Controle vindt opnieuw binnen de bestaande importlock plaats, vóór de eerste wijziging. */
export async function validateCfmRecoveryPlan(
  actor: StudyAdmin,
  client: PrismaClient,
  hash: string,
  reviewedMedia: boolean,
) {
  const plan = await cfmRecoveryPlan(actor, client);
  if (plan.planHash !== hash || (plan.requiresMediaReview && !reviewedMedia))
    throw new StudyPublishingError("CONFLICT");
  return plan;
}
export async function restoreCfmOriginals(
  actor: StudyAdmin,
  client: PrismaClient,
  plan: CfmRecoveryPlan,
  log: (line: string) => void,
) {
  for (const asset of plan.assets.filter(
    (a) => a.status === "ORIGINAL_SNAPSHOT" && a.mediaId,
  )) {
    const pin = CFM_SOURCE_2026.mediaLock.find(
      (a) => a.checksum === asset.originalChecksum && a.url === asset.url,
    )!;
    const original = await findOriginalCfmBytes(client, pin);
    const media = await client.contentMedia.findUnique({
      where: { id: asset.mediaId! },
    });
    if (!original || !media) throw new StudyPublishingError("CONFLICT");
    const changed = await restoreOriginalCfmFile(
      actor,
      client,
      media,
      original.bytes,
    );
    log(
      `CFM 2026; ${asset.lessonKeys.join(", ")}; origineel ${asset.originalChecksum}; snapshot ${original.runId}; ${changed ? "hersteld" : "al geldig"}`,
    );
  }
}
