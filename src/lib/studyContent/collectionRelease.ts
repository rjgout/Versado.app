import { z } from "zod";
import { emitToUser } from "@/lib/realtime";
import { DATA_EVENT_SOCKET_NAME } from "@/lib/data/scopes";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  requireStudyAdmin,
  studyObjectHash,
  StudyPublishingError,
  type StudyAdmin,
} from "./policy";
import { cfmOldTestament2026NlManifest as manifest, matchesCfm2026Catalogue } from "./cfm2026Manifest";
import { readStudyMedia } from "./storage";

export const studyCollectionReleaseSchema = z
  .object({
    collectionId: z.string().min(1).max(128),
    releaseToken: z.string().regex(/^[a-f0-9]{64}$/),
    actionId: z.uuid(),
  })
  .strict();

type ReleaseCollection = Prisma.ContentCollectionGetPayload<{
  include: { contentWork: { select: { kind: true } } };
}>;
type ReleaseEdition = Prisma.StudyLessonEditionGetPayload<{
  include: { lesson: true };
}>;
/** Dezelfde catalogusvoorwaarden voor overzicht én de gecontroleerde schrijftransactie. */
function releaseCatalogueState(collection: ReleaseCollection | null, editions: ReleaseEdition[]) {
  const supported =
    collection?.contentWork?.kind === "STUDY_PROGRAM" &&
    collection.work === manifest.workKey &&
    collection.editionKey === manifest.editionKey &&
    collection.language === manifest.language;
  const complete = supported && matchesCfm2026Catalogue(collection!, editions) &&
    editions.every((e) => e.publishedRevisionId);
  return {
    complete: Boolean(complete),
    published: editions.filter((e) => e.publishedRevisionId).length,
    total: editions.length,
    releaseToken: studyObjectHash([
      collection && [collection.id, collection.work, collection.editionKey, collection.language, collection.contentWork?.kind, collection.publicationState, collection.enabled, collection.visibleToUsers],
      editions.map((e) => [e.id, e.publishedRevisionId, e.publicationVersion, e.lesson.sourceKey, e.lesson.order, e.lesson.retiredAt]),
    ]),
  };
}

export async function studyCollectionReleaseState(
  actor: StudyAdmin,
  collectionId: string,
  client: PrismaClient = prisma,
) {
  requireStudyAdmin(actor);
  const collection = await client.contentCollection.findUnique({
    where: { id: collectionId },
    include: { contentWork: { select: { kind: true } } },
  });
  const editions = await client.studyLessonEdition.findMany({
    where: { collectionId },
    orderBy: { lesson: { order: "asc" } },
    include: { lesson: true },
  });
  return { collectionId, ...releaseCatalogueState(collection, editions) };
}
/** Collectie vrijgeven is géén zichtbaarheidsactie. Bestaande lespublicaties blijven immutable. */
export async function releaseStudyCollection(
  actor: StudyAdmin,
  input: { collectionId: string; releaseToken: string; actionId: string },
  client: PrismaClient = prisma,
) {
  requireStudyAdmin(actor);
  input = studyCollectionReleaseSchema.parse(input);
  const requestHash = studyObjectHash({
    collectionId: input.collectionId,
    releaseToken: input.releaseToken,
    actionId: input.actionId,
  });
  const recorded = await client.studyPublicationAction.findMany({
    where: {
      edition: { collectionId: input.collectionId },
      actionId: input.actionId,
      kind: "RELEASE_COLLECTION",
    },
  });
  if (recorded.length) {
    if (
      recorded.length !== manifest.lessons.length ||
      recorded.some(
        (a) => a.actorKey !== actor.id || a.requestHash !== requestHash,
      )
    )
      throw new StudyPublishingError("INVALID");
    return { changed: false };
  }
  const state = await studyCollectionReleaseState(
    actor,
    input.collectionId,
    client,
  );
  if (!state.complete) throw new StudyPublishingError("INCOMPLETE");
  // Alle bytes vóór de commit controleren. READY-identiteiten en bestanden zijn immutable.
  const media = await client.contentMedia.findMany({
    where: {
      revisionMedia: {
        some: {
          revision: {
            publishedBy: { some: { collectionId: input.collectionId } },
          },
        },
      },
    },
  });
  for (const file of media) {
    if (file.status !== "READY") throw new StudyPublishingError("MEDIA");
    await readStudyMedia(file, true);
  }
  const result = await client.$transaction(
    async (db) => {
      await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
      // Pointerwijzigingen vergrendelen dezelfde edities. Geen bron- of gebruikerswrites.
      await db.$queryRaw`SELECT id FROM "ContentCollection" WHERE id=${input.collectionId} FOR UPDATE`;
      const collection = await db.contentCollection.findUniqueOrThrow({
        where: { id: input.collectionId },
        include: { contentWork: { select: { kind: true } } },
      });
      const editions = await db.studyLessonEdition.findMany({
        where: { collectionId: input.collectionId },
        orderBy: { lesson: { order: "asc" } },
        include: { lesson: true },
      });
      const ids = editions.map((e) => e.id);
      await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
      const fresh = await db.studyLessonEdition.findMany({
        where: { collectionId: input.collectionId },
        orderBy: { lesson: { order: "asc" } },
        include: { lesson: true },
      });
      const prior = await db.studyPublicationAction.findMany({
        where: {
          lessonEditionId: { in: ids },
          actionId: input.actionId,
          kind: "RELEASE_COLLECTION",
          actorKey: actor.id,
        },
      });
      if (
        prior.length === manifest.lessons.length &&
        collection.publicationState === "PUBLISHED"
      ) {
        if (prior.some((a) => a.requestHash !== requestHash))
          throw new StudyPublishingError("INVALID");
        return { changed: false };
      }
      const current = releaseCatalogueState(collection, fresh);
      if (!current.complete) throw new StudyPublishingError("INCOMPLETE");
      if (current.releaseToken !== input.releaseToken)
        throw new StudyPublishingError("CONFLICT");
      if (
        !collection.enabled ||
        collection.visibleToUsers ||
        collection.publicationState !== "DRAFT"
      )
        throw new StudyPublishingError("UNAVAILABLE");
      for (const e of fresh) {
        const audit = await db.studyPublicationAction.findFirst({
          where: {
            lessonEditionId: e.id,
            revisionId: e.publishedRevisionId!,
            kind: { in: ["PUBLISH", "PUBLISH_DISPLAY_ONLY", "ROLLBACK"] },
          },
          orderBy: { version: "desc" },
        });
        if (!audit) throw new StudyPublishingError("INCOMPLETE");
        await db.studyPublicationAction.create({
          data: {
            lessonEditionId: e.id,
            revisionId: e.publishedRevisionId!,
            previousRevisionId: e.publishedRevisionId,
            importRunId: audit.importRunId,
            actorId: actor.id,
            actorKey: actor.id,
            actionId: input.actionId,
            kind: "RELEASE_COLLECTION",
            expectedVersion: e.publicationVersion,
            version: e.publicationVersion + 1,
            requestHash,
          },
        });
        await db.studyLessonEdition.update({
          where: { id: e.id },
          data: { publicationVersion: { increment: 1 } },
        });
      }
      await db.contentCollection.update({
        where: { id: collection.id },
        data: { publicationState: "PUBLISHED" },
      });
      return { changed: true };
    },
    { timeout: 20_000 },
  );
  if (result.changed) {
    emitToUser(actor.id, DATA_EVENT_SOCKET_NAME, { event: "contentChanged" });
    emitToUser(actor.id, DATA_EVENT_SOCKET_NAME, {
      event: "studyContentChanged",
    });
  }
  return result;
}
