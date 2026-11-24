import type { PrismaClient } from "@/generated/prisma/client";
import { CFM_SOURCES, cfmMediaSourceRegistered } from "./cfmSources";
import { refreshCfmImages } from "./cfmMedia";
import { readStudyMedia } from "./storage";
import { cfmApprovedSnapshot } from "./sourceApproval";
import {
  requireStudyAdmin,
  StudyPublishingError,
  studyObjectHash,
  type StudyAdmin,
} from "./policy";

/** Alleen inspectie van bestaande koppelingen/bestanden, nooit zoeken naar oude
 * snapshots of historische downloadbytes. Nieuwe lesinhoud blijft apart. */
export async function cfmRecoveryPlan(actor: StudyAdmin, client: PrismaClient) {
  requireStudyAdmin(actor);
  const works = CFM_SOURCES.map((s) => s.manifest.workKey);
  const editions = await client.studyLessonEdition.findMany({
    where: { workKey: { in: works } },
    select: {
      id: true,
      publishedRevisionId: true,
      draftRevisionId: true,
      publicationVersion: true,
    },
    orderBy: { id: "asc" },
  });
  const records = await client.contentMedia.findMany({
    where: {
      revisionMedia: {
        some: { revision: { edition: { workKey: { in: works } } } },
      },
    },
    orderBy: { id: "asc" },
  });
  const assets = [];
  for (const media of records) {
    if (
      !CFM_SOURCES.some((source) =>
        cfmMediaSourceRegistered(source.manifest.workKey, media.sourceMetadata),
      )
    )
      continue;
    let valid = media.status === "READY";
    if (valid)
      try {
        await readStudyMedia(media, true);
      } catch (error) {
        if (!(error instanceof StudyPublishingError) || error.code !== "MEDIA")
          throw error;
        valid = false;
      }
    assets.push({
      id: media.id,
      url: (media.sourceMetadata as { sourceKey: string }).sourceKey,
      checksum: media.checksum,
      byteSize: media.byteSize,
      status: valid
        ? ("CURRENT_VALID" as const)
        : ("DOWNLOAD_REQUIRED" as const),
    });
  }
  const approvedSnapshot = await cfmApprovedSnapshot();
  return {
    planHash: studyObjectHash({
      actor: actor.id,
      approvedSnapshot,
      editions,
      assets,
    }),
    approvedSnapshot,
    assets,
    registeredMedia: assets.length,
    readyMedia: assets.filter((a) => a.status === "CURRENT_VALID").length,
    importedLessons: editions.length,
    publishedLessons: editions.filter((e) => e.publishedRevisionId).length,
    expectedLessons: CFM_SOURCES.reduce(
      (n, s) => n + s.manifest.lessons.length,
      0,
    ),
    requiresMediaReview: false,
    revisionKeys: [] as string[],
  };
}
export type CfmRecoveryPlan = Awaited<ReturnType<typeof cfmRecoveryPlan>>;
export async function validateCfmRecoveryPlan(
  actor: StudyAdmin,
  client: PrismaClient,
  hash: string,
  _reviewedMedia: boolean,
) {
  void _reviewedMedia; // Compatibel met de bestaande beheer-API; oude mediabeoordeling is vervallen.
  const plan = await cfmRecoveryPlan(actor, client);
  if (plan.planHash !== hash) throw new StudyPublishingError("CONFLICT");
  return plan;
}
/** Bestaande beheeractie/API blijft compatibel; vernieuwt nu uitsluitend media. */
export async function restoreCfmOriginals(
  actor: StudyAdmin,
  client: PrismaClient,
  plan: CfmRecoveryPlan,
  log: (line: string) => void,
) {
  await validateCfmRecoveryPlan(actor, client, plan.planHash, false);
  const reports = [];
  for (const source of CFM_SOURCES) {
    const report = await refreshCfmImages(actor, client, source);
    log(
      `CFM ${source.volume.year}: ${report.filter((r) => r.status === "updated").length} afbeeldingen gecontroleerd; ${report.filter((r) => r.status === "retained").length} behouden na fout.`,
    );
    for (const failure of report.filter((r) => r.status === "retained"))
      log(
        `CFM ${source.volume.year}; ${new URL(failure.url).pathname.slice(0, 512)}; bestand behouden; ${failure.category}.`,
      );
    reports.push(...report);
  }
  return reports;
}
