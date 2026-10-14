import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  validateStudyRevision,
  studyRevisionHash,
  type StudyRevisionInput,
} from "./revisions";
import {
  validateSnapshotItem,
  snapshotRevisionInput,
  studyDocumentInventory,
  snapshotIdentity,
  type StudySnapshot,
} from "./fixtureAdapter";
import { lockStudyImportScope } from "./imports";
import {
  requireStudyAdmin,
  studyObjectHash,
  studyReleaseAllowed,
  StudyPublishingError,
  type StudyAdmin,
} from "./policy";
import {
  readStudyMedia,
  studyStorage,
  validateStudyMediaMetadata,
} from "./storage";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
import { resolveReferenceBatch, referenceDiagnosis, normalizedReference } from "@/lib/references/resolver";

export const studyPublicationSchema = z
  .object({
    editionId: z.string().min(1).max(128),
    revisionId: z.string().min(1).max(128),
    importRunId: z.string().min(1).max(128),
    kind: z.enum(["PUBLISH", "ROLLBACK"]),
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    actionId: z.uuid(),
  })
  .strict();
export type StudyPublicationRequest = z.infer<typeof studyPublicationSchema>;
export function validateStoredStudyRevision(revision: {
  schemaVersion: number;
  title: string;
  body: unknown;
  sourceMetadata: unknown;
  rightsMetadata: unknown;
  contentHash: string;
}) {
  const content = validateStudyRevision({
    schemaVersion: revision.schemaVersion as 1,
    title: revision.title,
    body: revision.body,
    sourceMetadata:
      revision.sourceMetadata as StudyRevisionInput["sourceMetadata"],
    rightsMetadata:
      revision.rightsMetadata as StudyRevisionInput["rightsMetadata"],
  });
  if (studyRevisionHash(content) !== revision.contentHash)
    throw new StudyPublishingError("INVALID");
  return content;
}
export async function publishStudyRevision(
  actor: StudyAdmin,
  raw: StudyPublicationRequest,
  client: PrismaClient = prisma,
) {
  requireStudyAdmin(actor);
  const input = studyPublicationSchema.parse(raw);
  const run = await client.contentImportRun.findUnique({
    where: { id: input.importRunId },
  });
  if (!run) throw new StudyPublishingError("UNAVAILABLE");
  if (!studyReleaseAllowed(run.adapterName))
    throw new StudyPublishingError("RELEASE_CLOSED");
  await studyStorage();
  const requestHash = studyObjectHash(input);
  const result = await client.$transaction(
    async (db) => {
      // Vaste volgorde: bronscope → importrun → editie; READY-media zijn immutable.
      await lockStudyImportScope(db, run.scopeKey);
      await db.$queryRaw`SELECT id FROM "ContentImportRun" WHERE id=${run.id} FOR UPDATE`;
      await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${input.editionId} FOR UPDATE`;
      const edition = await db.studyLessonEdition.findUnique({
        where: { id: input.editionId },
        include: { collection: true, lesson: { include: { work: true } } },
      });
      if (!edition) throw new StudyPublishingError("UNAVAILABLE");
      const previous = await db.studyPublicationAction.findUnique({
        where: {
          lessonEditionId_actionId: {
            lessonEditionId: edition.id,
            actionId: input.actionId,
          },
        },
      });
      if (previous) {
        if (
          previous.requestHash !== requestHash ||
          previous.actorKey !== actor.id
        )
          throw new StudyPublishingError("INVALID");
        return {
          changed: false,
          publicationVersion: edition.publicationVersion,
          publishedRevisionId: edition.publishedRevisionId,
          actionVersion: previous.version,
        };
      }
      if (edition.publicationVersion !== input.expectedVersion)
        throw new StudyPublishingError("CONFLICT");
      if (
        edition.lesson.retiredAt ||
        edition.lesson.work.kind !== "STUDY_PROGRAM" ||
        !edition.collection.enabled ||
        !["LEGACY", "PUBLISHED"].includes(
          edition.collection.publicationState,
        ) ||
        edition.workKey !== run.workKey ||
        edition.collectionId !== run.collectionId ||
        edition.collection.language !== run.language ||
        edition.collection.editionKey !== run.editionKey
      )
        throw new StudyPublishingError("UNAVAILABLE");
      const currentRun = await db.contentImportRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      if (
        currentRun.status !== "DRAFT_READY" ||
        currentRun.processedItems !== currentRun.foundItems ||
        currentRun.validatedItems !== currentRun.foundItems
      )
        throw new StudyPublishingError("INCOMPLETE");
      const snapshot = currentRun.snapshot as unknown as StudySnapshot;
      if (
        snapshotIdentity(snapshot) !== currentRun.sourceHash ||
        snapshot.workKey !== run.workKey ||
        snapshot.editionKey !== run.editionKey ||
        snapshot.language !== run.language
      )
        throw new StudyPublishingError("INVALID");
      const imported = await db.contentImportItem.findFirst({
        where: {
          runId: run.id,
          lessonEditionId: edition.id,
          revisionId: input.revisionId,
        },
      });
      const revision = await db.studyRevision.findFirst({
        where: { id: input.revisionId, lessonEditionId: edition.id },
        include: { media: { include: { media: true } }, references: true },
      });
      if (!imported || !revision) throw new StudyPublishingError("UNAVAILABLE");
      const source = snapshot.items.find(
        (item) => item.sourceKey === imported.sourceKey,
      );
      if (!source) throw new StudyPublishingError("INCOMPLETE");
      validateSnapshotItem(source);
      const sourceContent = snapshotRevisionInput(source);
      const content = validateStoredStudyRevision(revision);
      if (studyRevisionHash(sourceContent) !== revision.contentHash)
        throw new StudyPublishingError("INCOMPLETE");
      const inventory = studyDocumentInventory(content.body);
      if (
        revision.media.length !==
          new Set(inventory.figures.map((f) => f.mediaKey)).size ||
        revision.references.length !== inventory.references.length
      )
        throw new StudyPublishingError("INCOMPLETE");
      for (const figure of inventory.figures) {
        const binding = revision.media.find(
          (m) => m.mediaKey === figure.mediaKey,
        );
        if (
          !binding ||
          binding.media.status !== "READY" ||
          binding.media.width !== figure.width ||
          binding.media.height !== figure.height
        )
          throw new StudyPublishingError("MEDIA");
        const pin = content.sourceMetadata.mediaManifest?.find(
          (m) => m.mediaKey === figure.mediaKey,
        );
        if (
          !pin ||
          pin.checksum !== binding.media.checksum ||
          pin.mimeType !== binding.media.mimeType ||
          pin.rightsHash !== studyObjectHash(binding.media.rightsMetadata)
        )
          throw new StudyPublishingError("MEDIA");
        validateStudyMediaMetadata(binding.media);
        await readStudyMedia(binding.media, true);
      }
      const referenceResults=await resolveReferenceBatch(db,actor,{workKey:edition.workKey,collectionId:edition.collectionId,editionKey:edition.collection.editionKey,language:edition.collection.language},inventory.references.map(r=>({target:r.target,diagnosticKey:r.occurrenceKey})));
      for (const [referenceIndex,reference] of inventory.references.entries()) {
        const audit = revision.references.find(
          (r) => r.occurrenceKey === reference.occurrenceKey,
        );
        const evidence = source.evidence.find(
          (e) =>
            e.occurrenceKey === reference.occurrenceKey &&
            e.url === reference.target.externalUrl,
        );
        const actual=referenceResults[referenceIndex];
        if(audit?.evidenceKey!=="synthetic-reviewed-reference-v1"){
          const verified=referenceDiagnosis(actual);
          if(!audit || actual.kind==="unavailable" || audit.diagnosis!==verified.diagnosis || audit.evidenceKey!==verified.evidenceKey || studyObjectHash(audit.originalTarget)!==studyObjectHash(reference.target) || studyObjectHash(audit.normalizedTarget)!==studyObjectHash(normalizedReference(actual)))throw new StudyPublishingError("REFERENCES");
          continue;
        }
        // Bestaande synthetische fallback blijft uitsluitend achter de 2B-releasegate.
        if (
          !audit ||
          audit.diagnosis !== "EXTERNAL_VERIFIED" ||
          audit.evidenceKey !== "synthetic-reviewed-reference-v1" ||
          !evidence ||
          evidence.evidenceKey !== audit.evidenceKey ||
          audit.externalUrl !== "https://example.invalid/fixture-reference" ||
          audit.externalUrl !== evidence.url ||
          studyObjectHash(audit.originalTarget) !==
            studyObjectHash(reference.target) ||
          studyObjectHash(audit.normalizedTarget) !==
            studyObjectHash(reference.target)
        )
          throw new StudyPublishingError("REFERENCES");
      }
      if (input.kind === "PUBLISH" && edition.draftRevisionId !== revision.id)
        throw new StudyPublishingError("CONFLICT");
      if (
        input.kind === "ROLLBACK" &&
        !(await db.studyPublicationAction.findFirst({
          where: { lessonEditionId: edition.id, revisionId: revision.id },
        }))
      )
        throw new StudyPublishingError("UNAVAILABLE");
      const version = edition.publicationVersion + 1;
      await db.studyLessonEdition.update({
        where: { id: edition.id },
        data: {
          publishedRevisionId: revision.id,
          publicationVersion: version,
          ...(input.kind === "PUBLISH" ? { draftRevisionId: null } : {}),
        },
      });
      await db.studyPublicationAction.create({
        data: {
          lessonEditionId: edition.id,
          revisionId: revision.id,
          previousRevisionId: edition.publishedRevisionId,
          importRunId: run.id,
          actorId: actor.id,
          actorKey: actor.id,
          actionId: input.actionId,
          kind: input.kind,
          expectedVersion: input.expectedVersion,
          version,
          requestHash,
        },
      });
      return {
        changed: true,
        publicationVersion: version,
        publishedRevisionId: revision.id,
        actionVersion: version,
      };
    },
    { maxWait: 5000, timeout: 20_000 },
  );
  if (result.changed)
    emitToUser(actor.id, DATA_EVENT_SOCKET_NAME, {
      event: "studyContentChanged",
    });
  return result;
}

/** Stabiele ankers, niet arrayposities: verwijderde ankers blijven expliciet zichtbaar. */
export function diffStudyRevisions(
  before: StudyRevisionInput | null,
  after: StudyRevisionInput,
) {
  const old = before ? validateStudyRevision(before) : null,
    next = validateStudyRevision(after);
  const flatten = (content: typeof next) => {
    const result = new Map<string, { kind: string; value: unknown }>();
    function walk(value: unknown) {
      if (!value || typeof value !== "object") return;
      const row = value as Record<string, unknown>;
      if (typeof row.id === "string") {
        const kind = Array.isArray(row.blocks)
          ? "section"
          : typeof row.type === "string"
            ? row.type
            : "list";
        const media =
          kind === "figure"
            ? content.sourceMetadata.mediaManifest?.find(
                (m) => m.mediaKey === row.mediaKey,
              )
            : undefined;
        result.set(row.id, { kind, value: media ? { ...row, media } : row });
      }
      for (const child of Object.values(value)) walk(child);
    }
    walk(content.body);
    return result;
  };
  const a = old
      ? flatten(old)
      : new Map<string, { kind: string; value: unknown }>(),
    b = flatten(next),
    changes: Array<{
      anchor: string;
      kind: string;
      change: "added" | "removed" | "changed";
    }> = [];
  for (const [id, value] of a) {
    const target = b.get(id);
    if (!target)
      changes.push({ anchor: id, kind: value.kind, change: "removed" });
    else if (studyObjectHash(value.value) !== studyObjectHash(target.value))
      changes.push({ anchor: id, kind: target.kind, change: "changed" });
  }
  for (const [id, value] of b)
    if (!a.has(id))
      changes.push({ anchor: id, kind: value.kind, change: "added" });
  return {
    changes,
    sourceChanged:
      !old ||
      studyObjectHash(old.sourceMetadata) !==
        studyObjectHash(next.sourceMetadata),
    rightsChanged:
      !old ||
      studyObjectHash(old.rightsMetadata) !==
        studyObjectHash(next.rightsMetadata),
    titleChanged: !old || old.title !== next.title,
  };
}
