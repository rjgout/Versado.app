import { randomUUID } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  ContentImportRun,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { appendStudyRevision, studyRevisionHash } from "./revisions";
import {
  studyFixture,
  snapshotIdentity,
  validateSnapshotItem,
  snapshotRevisionInput,
  type StudyFixtureKey,
  type StudySnapshot,
} from "./fixtureAdapter";
import {
  requireStudyAdmin,
  studyObjectHash,
  studyReleaseAllowed,
  StudyPublishingError,
  type StudyAdmin,
} from "./policy";
import {
  studyStorage,
  validateStudyImage,
  installStudyMedia,
  readStudyMedia,
  validateStudyMediaMetadata,
} from "./storage";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
import { resolveReferenceBatch, referenceDiagnosis, normalizedReference } from "@/lib/references/resolver";

type Tx = Prisma.TransactionClient;
export interface StudyImportLease {
  runId: string;
  holder: string;
  fence: number;
}
async function dbNow(db: Tx) {
  return (
    await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`
  )[0].now;
}
export async function configureStudyTransaction(db: Tx) {
  await db.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
  await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
  await db.$executeRaw`SET LOCAL statement_timeout='15s'`;
}
export async function lockStudyImportScope(db: Tx, scopeKey: string) {
  await configureStudyTransaction(db);
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scopeKey},0))`;
}
/** Fencing wordt op de databaseklok getest, nooit op de worker-/toestelklok. */
export async function requireStudyLease(db: Tx, lease: StudyImportLease) {
  await configureStudyTransaction(db);
  await db.$queryRaw`SELECT id FROM "ContentImportRun" WHERE id=${lease.runId} FOR UPDATE`;
  const run = await db.contentImportRun.findUnique({
    where: { id: lease.runId },
  });
  if (
    !run ||
    run.status !== "RUNNING" ||
    run.leaseHolder !== lease.holder ||
    run.fence !== lease.fence ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt <= (await dbNow(db))
  )
    throw new StudyPublishingError("LEASE_LOST");
  return run;
}
async function renewStudyLease(db: Tx, lease: StudyImportLease) {
  const updated = await db.$queryRaw<
    Array<{ id: string }>
  >`UPDATE "ContentImportRun" SET "leaseExpiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+INTERVAL '45 seconds' WHERE id=${lease.runId} AND "leaseHolder"=${lease.holder} AND fence=${lease.fence} AND status='RUNNING' AND "leaseExpiresAt">(clock_timestamp() AT TIME ZONE 'UTC') RETURNING id`;
  if (!updated.length) throw new StudyPublishingError("LEASE_LOST");
}
export async function createStudyImport(
  actor: StudyAdmin,
  collectionId: string,
  fixtureKey: StudyFixtureKey,
  client: PrismaClient = prisma,
) {
  requireStudyAdmin(actor);
  if (!studyReleaseAllowed("synthetic-v1"))
    throw new StudyPublishingError("RELEASE_CLOSED");
  await studyStorage();
  const collection = await client.contentCollection.findFirst({
    where: {
      id: collectionId,
      ...readingAccessWhere(actor, "admin-preview"),
      contentWork: { kind: "STUDY_PROGRAM" },
    },
  });
  if (
    !collection?.work ||
    !collection.work.startsWith("synthetic-study-") ||
    collection.editionKey !== "fixture-v1" ||
    collection.language !== "nl"
  )
    throw new StudyPublishingError("UNAVAILABLE");
  const snapshot = studyFixture(fixtureKey, collection.work);
  const scopeKey = studyObjectHash([
    snapshot.adapterName,
    collection.id,
    snapshot.period.sourceKey,
  ]);
  const sourceHash = snapshotIdentity(snapshot);
  return client.$transaction(async (db) => {
    await lockStudyImportScope(db, scopeKey);
    const previous = await db.contentImportRun.findUnique({
      where: { scopeKey_sourceHash: { scopeKey, sourceHash } },
    });
    if (previous) return previous;
    if (
      await db.contentImportRun.findFirst({
        where: { scopeKey, status: { in: ["CREATED", "RUNNING"] } },
      })
    )
      throw new StudyPublishingError("BUSY");
    return db.contentImportRun.create({
      data: {
        adapterName: snapshot.adapterName,
        adapterVersion: snapshot.adapterVersion,
        collectionId: collection.id,
        workKey: collection.work!,
        editionKey: collection.editionKey,
        language: collection.language,
        periodSourceKey: snapshot.period.sourceKey,
        sourceVersion: snapshot.sourceVersion,
        sourceHash,
        scopeKey,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        foundItems: snapshot.items.length,
        createdById: actor.id,
        createdByKey: actor.id,
      },
    });
  });
}
export async function claimStudyImport(
  actor: StudyAdmin,
  runId: string,
  client: PrismaClient = prisma,
): Promise<StudyImportLease | null> {
  requireStudyAdmin(actor);
  const initial = await client.contentImportRun.findUnique({
    where: { id: runId },
  });
  if (!initial) throw new StudyPublishingError("UNAVAILABLE");
  if (!studyReleaseAllowed(initial.adapterName))
    throw new StudyPublishingError("RELEASE_CLOSED");
  return client.$transaction(async (db) => {
    await lockStudyImportScope(db, initial.scopeKey);
    await db.$queryRaw`SELECT id FROM "ContentImportRun" WHERE id=${runId} FOR UPDATE`;
    const run = await db.contentImportRun.findUniqueOrThrow({
      where: { id: runId },
    });
    if (run.status === "DRAFT_READY") return null;
    const now = await dbNow(db);
    if (
      run.status === "RUNNING" &&
      run.leaseExpiresAt &&
      run.leaseExpiresAt > now
    )
      throw new StudyPublishingError("BUSY");
    if (
      await db.contentImportRun.findFirst({
        where: {
          scopeKey: run.scopeKey,
          id: { not: runId },
          status: { in: ["CREATED", "RUNNING"] },
        },
      })
    )
      throw new StudyPublishingError("BUSY");
    const holder = randomUUID(),
      fence = run.fence + 1;
    await db.contentImportRun.update({
      where: { id: runId },
      data: {
        status: "RUNNING",
        leaseHolder: holder,
        leaseExpiresAt: new Date(now.getTime() + 45_000),
        fence,
        finishedAt: null,
        diagnostics: [],
      },
    });
    return { runId, holder, fence };
  });
}
export async function persistStudyImportItem(
  actor: StudyAdmin,
  lease: StudyImportLease,
  itemIndex: number,
  client: PrismaClient = prisma,
) {
  requireStudyAdmin(actor);
  const initial = await client.$transaction((db) =>
    requireStudyLease(db, lease),
  );
  const snapshot = initial.snapshot as unknown as StudySnapshot;
  if (
    snapshotIdentity(snapshot) !== initial.sourceHash ||
    snapshot.workKey !== initial.workKey ||
    snapshot.editionKey !== initial.editionKey ||
    snapshot.language !== initial.language ||
    !studyReleaseAllowed(snapshot.adapterName)
  )
    throw new StudyPublishingError("INVALID");
  const item = snapshot.items[itemIndex];
  if (!item) throw new StudyPublishingError("INVALID");
  const normalized = validateSnapshotItem(item);
  const exists = await client.contentImportItem.findUnique({
    where: {
      runId_sourceKey: { runId: initial.id, sourceKey: item.sourceKey },
    },
  });
  if (exists) return exists;
  await client.$transaction(async (db) => {
    await requireStudyLease(db, lease);
    await db.contentImportRun.update({
      where: { id: lease.runId },
      data: { validatedItems: Math.max(initial.validatedItems, itemIndex + 1) },
    });
    await renewStudyLease(db, lease);
  });
  const mediaIds = new Map<string, string>();
  for (const asset of item.media) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(asset.base64))
      throw new StudyPublishingError("MEDIA");
    const bytes = Buffer.from(asset.base64, "base64"),
      image = await validateStudyImage(bytes, asset.mimeType, asset.checksum);
    const store = await studyStorage();
    const media = await client.$transaction(async (db) => {
      await requireStudyLease(db, lease);
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`study-media:${image.checksum}`},0))`;
      const existing = await db.contentMedia.findUnique({
        where: { checksum: image.checksum },
      });
      if (existing) {
        validateStudyMediaMetadata(existing);
        if (
          existing.volumeId !== store.volumeId ||
          existing.storageKey !== image.storageKey ||
          // Dezelfde bytes mogen geen afwijkende rechten ongemerkt overnemen.
          studyObjectHash(existing.rightsMetadata) !== studyObjectHash(asset.rights)
        )
          throw new StudyPublishingError("MEDIA");
        return existing;
      }
      return db.contentMedia.create({
        data: {
          ...image,
          volumeId: store.volumeId,
          sourceMetadata: {
            sourceKey: asset.sourceKey,
            adapter: initial.adapterName,
          },
          rightsMetadata: asset.rights,
        },
      });
    });
    if (media.status !== "READY") {
      await installStudyMedia(bytes, image);
      await client.$transaction(async (db) => {
        await requireStudyLease(db, lease);
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`study-media:${image.checksum}`},0))`;
        const current = await db.contentMedia.findUniqueOrThrow({
          where: { id: media.id },
        });
        await readStudyMedia(current, true);
        if (current.status !== "READY")
          await db.contentMedia.update({
            where: { id: media.id },
            data: { status: "READY" },
          });
        await renewStudyLease(db, lease);
      });
    } else await readStudyMedia(media, true);
    mediaIds.set(asset.mediaKey, media.id);
  }
  return client.$transaction(
    async (db) => {
      await lockStudyImportScope(db, initial.scopeKey);
      await requireStudyLease(db, lease);
      const already = await db.contentImportItem.findUnique({
        where: {
          runId_sourceKey: { runId: initial.id, sourceKey: item.sourceKey },
        },
      });
      if (already) return already;
      const period = await db.studyPeriod.upsert({
        where: {
          workKey_sourceKey: {
            workKey: initial.workKey,
            sourceKey: snapshot.period.sourceKey,
          },
        },
        create: { workKey: initial.workKey, ...snapshot.period },
        update: {},
      });
      const lesson = await db.studyLesson.upsert({
        where: {
          workKey_periodId_sourceKey: {
            workKey: initial.workKey,
            periodId: period.id,
            sourceKey: item.sourceKey,
          },
        },
        create: {
          workKey: initial.workKey,
          periodId: period.id,
          sourceKey: item.sourceKey,
          order: item.order,
        },
        update: {},
      });
      if (lesson.retiredAt) throw new StudyPublishingError("UNAVAILABLE");
      const edition = await db.studyLessonEdition.upsert({
        where: {
          lessonId_collectionId: {
            lessonId: lesson.id,
            collectionId: initial.collectionId,
          },
        },
        create: {
          lessonId: lesson.id,
          collectionId: initial.collectionId,
          workKey: initial.workKey,
          slug: item.slug,
        },
        update: {},
      });
      await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${edition.id} FOR UPDATE`;
      const pinned = snapshotRevisionInput(item);
      const hash = studyRevisionHash(pinned);
      const revision =
        (await db.studyRevision.findFirst({
          where: { lessonEditionId: edition.id, contentHash: hash },
          orderBy: { revisionNumber: "asc" },
        })) ?? (await appendStudyRevision(actor, edition.id, pinned, db));
      for (const figure of normalized.inventory.figures) {
        const mediaId = mediaIds.get(figure.mediaKey);
        if (!mediaId) throw new StudyPublishingError("MEDIA");
        const media = await db.contentMedia.findUniqueOrThrow({
          where: { id: mediaId },
        });
        if (
          media.status !== "READY" ||
          media.width !== figure.width ||
          media.height !== figure.height
        )
          throw new StudyPublishingError("MEDIA");
        const binding = await db.studyRevisionMedia.findUnique({
          where: {
            revisionId_mediaKey: {
              revisionId: revision.id,
              mediaKey: figure.mediaKey,
            },
          },
        });
        if (binding && binding.mediaId !== mediaId)
          throw new StudyPublishingError("MEDIA");
        if (!binding)
          await db.studyRevisionMedia.create({
            data: {
              revisionId: revision.id,
              mediaKey: figure.mediaKey,
              mediaId,
            },
          });
      }
      const referenceResults=await resolveReferenceBatch(db,actor,{workKey:initial.workKey,collectionId:initial.collectionId,editionKey:initial.editionKey,language:initial.language},normalized.inventory.references.map(r=>({target:r.target,diagnosticKey:r.occurrenceKey})));
      for (const [referenceIndex,reference] of normalized.inventory.references.entries()) {
        const evidence = item.evidence.find(
          (e) =>
            e.occurrenceKey === reference.occurrenceKey &&
            e.url === reference.target.externalUrl &&
            e.evidenceKey === "synthetic-reviewed-reference-v1",
        );
        const external =
          evidence &&
          reference.target.sourceKey === "fixture:reference" &&
          evidence.url === "https://example.invalid/fixture-reference";
        const old = await db.contentReference.findUnique({
          where: {
            revisionId_occurrenceKey: {
              revisionId: revision.id,
              occurrenceKey: reference.occurrenceKey,
            },
          },
        });
        if (!old)
          await db.contentReference.create({
            data: {
              revisionId: revision.id,
              occurrenceKey: reference.occurrenceKey,
              label: reference.label,
              originalTarget: reference.target as Prisma.InputJsonValue,
              normalizedTarget: external ? reference.target as Prisma.InputJsonValue : normalizedReference(referenceResults[referenceIndex]) as Prisma.InputJsonValue,
              externalUrl:
                typeof reference.target.externalUrl === "string"
                  ? reference.target.externalUrl
                  : null,
              diagnosis: external ? "EXTERNAL_VERIFIED" : referenceDiagnosis(referenceResults[referenceIndex]).diagnosis,
              evidenceKey: external ? evidence.evidenceKey : referenceDiagnosis(referenceResults[referenceIndex]).evidenceKey,
            },
          });
      }
      const result = await db.contentImportItem.create({
        data: {
          runId: initial.id,
          sourceKey: item.sourceKey,
          lessonEditionId: edition.id,
          revisionId: revision.id,
        },
      });
      if (edition.publishedRevisionId !== revision.id)
        await db.studyLessonEdition.update({
          where: { id: edition.id },
          data: { draftRevisionId: revision.id },
        });
      const count = await db.contentImportItem.count({
        where: { runId: initial.id },
      });
      const warnings = normalized.inventory.references.filter(
        (ref,index) => referenceResults[index].kind==="unavailable" &&
          !item.evidence.some(
            (e) =>
              e.occurrenceKey === ref.occurrenceKey &&
              e.url === ref.target.externalUrl &&
              e.evidenceKey === "synthetic-reviewed-reference-v1",
          ),
      );
      const run = await db.contentImportRun.findUniqueOrThrow({
        where: { id: initial.id },
      });
      const diagnostics = [
        ...(Array.isArray(run.diagnostics) ? run.diagnostics : []),
        ...(warnings.length
          ? [
              {
                severity: "warning",
                code: "REFERENCES",
                count: warnings.length,
              },
            ]
          : []),
      ].slice(-20) as Prisma.InputJsonValue;
      await db.contentImportRun.update({
        where: { id: initial.id },
        data: { periodId: period.id, processedItems: count, diagnostics },
      });
      await renewStudyLease(db, lease);
      return result;
    },
    { maxWait: 5000, timeout: 15_000 },
  );
}
export async function executeStudyImport(
  actor: StudyAdmin,
  runId: string,
  client: PrismaClient = prisma,
) {
  let lease: StudyImportLease | null = null;
  try {
    lease = await claimStudyImport(actor, runId, client);
    if (!lease) return;
    const run = await client.contentImportRun.findUniqueOrThrow({
        where: { id: runId },
      }),
      snapshot = run.snapshot as unknown as StudySnapshot;
    for (let index = 0; index < snapshot.items.length; index++)
      await persistStudyImportItem(actor, lease, index, client);
    await client.$transaction(async (db) => {
      const current = await requireStudyLease(db, lease!);
      if (current.processedItems !== current.foundItems)
        throw new StudyPublishingError("INCOMPLETE");
      await renewStudyLease(db, lease!);
      await db.contentImportRun.update({
        where: { id: runId },
        data: {
          status: "DRAFT_READY",
          leaseHolder: null,
          leaseExpiresAt: null,
          finishedAt: await dbNow(db),
        },
      });
    });
  } catch (error) {
    if (
      !lease ||
      (error instanceof StudyPublishingError && error.code === "LEASE_LOST")
    )
      throw error;
    await client
      .$transaction(async (db) => {
        const current = await requireStudyLease(db, lease!);
        await db.contentImportRun.update({
          where: { id: runId },
          data: {
            status: "FAILED",
            leaseHolder: null,
            leaseExpiresAt: null,
            finishedAt: await dbNow(db),
            diagnostics: [
              ...(Array.isArray(current.diagnostics)
                ? current.diagnostics
                : []),
              {
                severity: "error",
                code:
                  error instanceof StudyPublishingError
                    ? error.code
                    : "INVALID",
              },
            ].slice(-20) as Prisma.InputJsonValue,
          },
        });
      })
      .catch(() => {});
    throw error;
  } finally {
    if (lease)
      emitToUser(actor.id, DATA_EVENT_SOCKET_NAME, {
        event: "studyContentChanged",
      });
  }
}
/** Route start enkel een bestaande duurzame run; geen polling/seed/scheduler-import. */
export function launchStudyImport(
  actor: StudyAdmin,
  run: Pick<ContentImportRun, "id">,
) {
  void executeStudyImport(actor, run.id).catch(() => {});
}

export async function resumeStudyImport(
  actor: StudyAdmin,
  runId: string,
  client: PrismaClient = prisma,
) {
  requireStudyAdmin(actor);
  const run = await client.contentImportRun.findUnique({
    where: { id: runId },
  });
  if (!run) throw new StudyPublishingError("UNAVAILABLE");
  if (!studyReleaseAllowed(run.adapterName))
    throw new StudyPublishingError("RELEASE_CLOSED");
  await studyStorage();
  launchStudyImport(actor, run);
  return run.id;
}
