import { studyCollectionReleaseState } from "./collectionRelease";
import { cfmDisplayOnlyKeys } from "./cfmReview";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import {
  requireStudyAdmin,
  StudyPublishingError,
  studyReleaseAllowed,
  type StudyAdmin,
} from "./policy";
import { studyStorage, readStudyMedia } from "./storage";
import { validateStoredStudyRevision, diffStudyRevisions } from "./publication";
import { studyDocumentInventory } from "./fixtureAdapter";
import { cfmSourceOfAdapter, cfmSourceOfWork, isCfmAdapter } from "./cfmSources";
import { STUDY_FIXTURES } from "./fixtureAdapter";
import { verifiedOfficialUrl } from "@/lib/references/evidence";

async function readStudyAdmin<T>(
  read: (db: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SET TRANSACTION READ ONLY`;
      await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
      await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
      return read(db);
    },
    { maxWait: 5000, timeout: 12000 },
  );
}

export async function studyPublishingOverview(actor: StudyAdmin) {
  requireStudyAdmin(actor);
  let storageReady = false;
  try {
    await studyStorage();
    storageReady = true;
  } catch {}
  const [collections, runs, editions] = await readStudyAdmin(
    async (db) =>
      [
        await db.contentCollection.findMany({
          where: {
            ...readingAccessWhere(actor, "admin-preview"),
            contentWork: { kind: "STUDY_PROGRAM" },
          },
          orderBy: [
            { work: "asc" },
            { editionKey: "asc" },
            { language: "asc" },
          ],
          select: {
            id: true,
            name: true,
            work: true,
            editionKey: true,
            language: true,
            publicationState: true,
            visibleToUsers: true,
            enabled: true,
          },
        }),
        await db.contentImportRun.findMany({
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: 50,
          select: {
            id: true,
            collectionId: true,
            adapterName: true,
            adapterVersion: true,
            sourceVersion: true,
            sourceHash: true,
            status: true,
            foundItems: true,
            validatedItems: true,
            processedItems: true,
            diagnostics: true,
            leaseExpiresAt: true,
            startedAt: true,
            finishedAt: true,
          },
        }),
        await db.studyLessonEdition.findMany({
          where: {
            collection: readingAccessWhere(actor, "admin-preview"),
            lesson: { work: { kind: "STUDY_PROGRAM" } },
          },
          orderBy: [
            { collectionId: "asc" },
            { lesson: { order: "asc" } },
            { id: "asc" },
          ],
          take: 400,
          select: {
            id: true,
            slug: true,
            collectionId: true,
            publicationVersion: true,
            lesson: {
              select: { sourceKey: true, period: { select: { label: true } } },
            },
            publishedRevision: {
              select: { id: true, title: true, revisionNumber: true },
            },
            draftRevision: {
              select: { id: true, title: true, revisionNumber: true },
            },
          },
        }),
      ] as const,
  );
  // Goedkope programma-telling (alleen database, geen bestandscontrole): de zware voorcontrole is een afzonderlijke actie.
  const counts = await readStudyAdmin((db) =>
    db.studyLessonEdition.findMany({
      where: { collectionId: { in: collections.map((c) => c.id) }, lesson: { retiredAt: null } },
      select: { collectionId: true, draftRevisionId: true, publishedRevisionId: true },
    }),
  );
  const programs = collections.map((c) => {
    const rows = counts.filter((e) => e.collectionId === c.id);
    return {
      id: c.id,
      name: c.name,
      work: c.work,
      editionKey: c.editionKey,
      language: c.language,
      enabled: c.enabled,
      publicationState: c.publicationState,
      visibleToUsers: c.visibleToUsers,
      expected: cfmSourceOfWork(c.work)?.manifest.lessons.length ?? rows.length,
      imported: rows.filter((e) => e.draftRevisionId || e.publishedRevisionId).length,
      published: rows.filter((e) => e.publishedRevisionId).length,
      pending: rows.filter((e) => e.draftRevisionId).length,
    };
  });
  return {
    storageReady,
    importAllowed: studyReleaseAllowed("synthetic-v1"),
    publicationAllowed: studyReleaseAllowed("synthetic-v1"),
    // Synthetische fixtures bestaan alleen in een testomgeving; in productie blijft de importbediening verborgen.
    fixtures: studyReleaseAllowed("synthetic-v1") ? STUDY_FIXTURES : [],
    programs,
    collections: await Promise.all(
      collections.map(async (c) => ({
        ...c,
        release: await studyCollectionReleaseState(actor, c.id),
      })),
    ),
    importCollections: collections.filter(
      (c) =>
        c.work?.startsWith("synthetic-study-") &&
        c.editionKey === "fixture-v1" &&
        c.language === "nl",
    ),
    runs: runs.map((run) => ({
      ...run,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
    })),
    editions,
  };
}
export type StudyPublishingOverview = Awaited<
  ReturnType<typeof studyPublishingOverview>
>;
export async function studyRevisionPreview(
  actor: StudyAdmin,
  editionId: string,
  revisionId: string,
) {
  requireStudyAdmin(actor);
  const edition = await readStudyAdmin((db) =>
    db.studyLessonEdition.findFirst({
      where: {
        id: editionId,
        collection: readingAccessWhere(actor, "admin-preview"),
        lesson: { work: { kind: "STUDY_PROGRAM" } },
      },
      include: { publishedRevision: true },
    }),
  );
  const revision = edition
    ? await readStudyAdmin((db) =>
        db.studyRevision.findFirst({
          where: { id: revisionId, lessonEditionId: edition.id },
          include: {
            media: { include: { media: true } },
            references: true,
            importItems: {
              where: { run: { status: "DRAFT_READY" } },
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { run: { select: { id: true, status: true } } },
            },
          },
        }),
      )
    : null;
  if (!edition || !revision) throw new StudyPublishingError("UNAVAILABLE");
  const content = validateStoredStudyRevision(revision);
  const before = edition.publishedRevision
    ? validateStoredStudyRevision(edition.publishedRevision)
    : null;
  const inventory = studyDocumentInventory(content.body);
  const media = [];
  for (const figure of new Map(
    inventory.figures.map((f) => [f.mediaKey, f]),
  ).values()) {
    const binding = revision.media.find((m) => m.mediaKey === figure.mediaKey);
    let ready =
      binding?.media.status === "READY" &&
      binding.media.width === figure.width &&
      binding.media.height === figure.height;
    if (ready && binding)
      try {
        await readStudyMedia(binding.media);
      } catch {
        ready = false;
      }
    media.push({
      mediaKey: figure.mediaKey,
      mediaId: binding?.mediaId ?? null,
      ready,
      mimeType: binding?.media.mimeType ?? null,
      width: figure.width,
      height: figure.height,
    });
  }
  const importRun = revision.importItems[0]?.runId
    ? await prisma.contentImportRun.findUnique({
        where: { id: revision.importItems[0].runId },
        select: { adapterName: true, sourceVersion: true },
      })
    : null;
  let displayOnlyKeys: string[] = [];
  if (isCfmAdapter(importRun?.adapterName))
    try {
      displayOnlyKeys = await cfmDisplayOnlyKeys(
        content.sourceMetadata.sourceKey,
        content,
        importRun!.sourceVersion,
        cfmSourceOfAdapter(importRun!.adapterName),
      );
    } catch {}
  return {
    publicationAllowed: Boolean(
      importRun && studyReleaseAllowed(importRun.adapterName),
    ),
    displayOnlyKeys,
    editionId,
    revisionId,
    publicationVersion: edition.publicationVersion,
    publishedRevisionId: edition.publishedRevisionId,
    draftRevisionId: edition.draftRevisionId,
    revisionNumber: revision.revisionNumber,
    contentHash: revision.contentHash,
    ...content,
    media,
    references: inventory.references.map((reference) => {
      const audit = revision.references.find(
        (r) => r.occurrenceKey === reference.occurrenceKey,
      );
      return {
        occurrenceKey: reference.occurrenceKey,
        label: reference.label,
        originalTarget: audit?.originalTarget ?? reference.target,
        diagnosis: audit?.diagnosis ?? "UNRESOLVED",
        externalUrl: audit?.externalUrl ?? null,
        approvedExternalUrl:
          audit?.diagnosis === "EXTERNAL_VERIFIED"
            ? verifiedOfficialUrl(audit.externalUrl)
            : null,
        normalizedTarget: audit?.normalizedTarget ?? null,
        evidenceKey: audit?.evidenceKey ?? null,
      };
    }),
    wasPublished:
      (await readStudyAdmin((db) =>
        db.studyPublicationAction.count({
          where: { lessonEditionId: editionId, revisionId },
        }),
      )) > 0,
    importRunId:
      revision.importItems.find((item) => item.run.status === "DRAFT_READY")
        ?.runId ?? null,
    diff: diffStudyRevisions(before, content),
  };
}
export type StudyRevisionPreview = Awaited<
  ReturnType<typeof studyRevisionPreview>
>;

/** Keyset-paginering houdt ook oude revisies bereikbaar, zonder onbegrensde JSON. */
export async function studyRevisionHistory(
  actor: StudyAdmin,
  editionId: string,
  before?: number,
) {
  requireStudyAdmin(actor);
  const edition = await readStudyAdmin((db) =>
    db.studyLessonEdition.findFirst({
      where: {
        id: editionId,
        collection: readingAccessWhere(actor, "admin-preview"),
        lesson: { work: { kind: "STUDY_PROGRAM" } },
      },
      select: { id: true },
    }),
  );
  if (!edition) throw new StudyPublishingError("UNAVAILABLE");
  const rows = await readStudyAdmin((db) =>
    db.studyRevision.findMany({
      where: {
        lessonEditionId: editionId,
        ...(before ? { revisionNumber: { lt: before } } : {}),
      },
      orderBy: { revisionNumber: "desc" },
      take: 21,
      select: { id: true, title: true, revisionNumber: true },
    }),
  );
  return {
    revisions: rows.slice(0, 20),
    nextCursor: rows.length > 20 ? rows[19].revisionNumber : null,
  };
}
export type StudyRevisionHistory = Awaited<
  ReturnType<typeof studyRevisionHistory>
>;
