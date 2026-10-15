import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { type ContentActor, readingAccessWhere } from "@/lib/contentAccess";
import {
  parseStudyDocument,
  safeStudyUrlSchema,
  studySourceKeySchema,
  type StudyDocument,
} from "./schema";

const label = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => value.trim().length > 0);
export const studyRightsMetadataSchema = z
  .object({
    holder: label,
    permission: z
      .string()
      .min(1)
      .max(5000)
      .refine((value) => value.trim().length > 0),
    licenseUrl: safeStudyUrlSchema.optional(),
  })
  .strict();
const metadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: label,
    sourceMetadata: z
      .object({
        sourceKey: studySourceKeySchema,
        referenceAuditHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        url: safeStudyUrlSchema.optional(),
        name: label.optional(),
        mediaManifest: z
          .array(
            z
              .object({
                mediaKey: z.string().min(1).max(128),
                checksum: z.string().regex(/^[a-f0-9]{64}$/),
                mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
                width: z.number().int().positive().max(8192),
                height: z.number().int().positive().max(8192),
                rightsHash: z.string().regex(/^[a-f0-9]{64}$/),
              })
              .strict(),
          )
          .max(100)
          .optional(),
      })
      .strict(),
    rightsMetadata: studyRightsMetadataSchema,
  })
  .strict();
export interface StudyRevisionInput {
  schemaVersion: 1;
  title: string;
  body: unknown;
  sourceMetadata: {
    sourceKey: string;
    referenceAuditHash?: string;
    url?: string;
    name?: string;
    mediaManifest?: Array<{
      mediaKey: string;
      checksum: string;
      mimeType: "image/png" | "image/jpeg" | "image/webp";
      width: number;
      height: number;
      rightsHash: string;
    }>;
  };
  rightsMetadata: { holder: string; permission: string; licenseUrl?: string };
}
export function validateStudyRevision(input: StudyRevisionInput) {
  const { body, ...metadata } = input;
  return { ...metadataSchema.parse(metadata), body: parseStudyDocument(body) };
}
// Sorteer alleen objectkeys; volgorde/tekst/Unicode/arrays zijn deel van de inhoud.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function studyRevisionHash(input: StudyRevisionInput): string {
  return createHash("sha256")
    .update(canonicalJson(validateStudyRevision(input)), "utf8")
    .digest("hex");
}

/** Interne insert-only bouwsteen, geen import/publish-API. Actor uit serverauthenticatie. */
export async function appendStudyRevision(
  actor: ContentActor,
  editionId: string,
  input: StudyRevisionInput,
  client: PrismaClient | Prisma.TransactionClient = prisma,
) {
  if (!actor.isAdmin) throw new Error("STUDY_WRITE_FORBIDDEN");
  const validated = validateStudyRevision(input);
  const contentHash = studyRevisionHash(validated);
  const write = async (db: Prisma.TransactionClient) => {
    await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${editionId} FOR UPDATE`;
    const edition = await db.studyLessonEdition.findUnique({
      where: { id: editionId },
      include: {
        lesson: { include: { work: true, period: true } },
        collection: true,
      },
    });
    if (
      !edition ||
      edition.lesson.retiredAt ||
      edition.lesson.work.kind !== "STUDY_PROGRAM" ||
      edition.workKey !== edition.lesson.workKey ||
      edition.workKey !== edition.collection.work ||
      edition.workKey !== edition.lesson.period.workKey
    )
      throw new Error("STUDY_EDITION_INVALID");
    const last = await db.studyRevision.aggregate({
      where: { lessonEditionId: editionId },
      _max: { revisionNumber: true },
    });
    return db.studyRevision.create({
      data: {
        lessonEditionId: editionId,
        revisionNumber: (last._max.revisionNumber ?? 0) + 1,
        contentHash,
        ...validated,
        body: validated.body as Prisma.InputJsonValue,
      },
    });
  };
  return "$transaction" in client
    ? client.$transaction(write, { maxWait: 5000, timeout: 10_000 })
    : write(client);
}

type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type PublishedStudyDTO = DeepReadonly<{
  lessonId: string;
  workKey: string;
  periodId: string;
  sourceKey: string;
  editionId: string;
  collectionId: string;
  editionKey: string;
  language: string;
  slug: string;
  revisionId: string;
  revisionNumber: number;
  schemaVersion: 1;
  contentHash: string;
  title: string;
  body: StudyDocument;
}>;
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Exacte collectie, geen taal/familie-fallback. Geen cache, writes of impliciete adminpreview. */
export async function getPublishedStudyLesson(
  actor: ContentActor | null,
  lessonId: string,
  collectionId: string,
  db: Pick<Prisma.TransactionClient, "studyLessonEdition"> = prisma,
): Promise<PublishedStudyDTO | null> {
  if (!actor) return null;
  const edition = await db.studyLessonEdition.findFirst({
    where: {
      lessonId,
      collectionId,
      publishedRevisionId: { not: null },
      lesson: { retiredAt: null, work: { kind: "STUDY_PROGRAM" } },
      collection: readingAccessWhere(actor),
    },
    include: { lesson: true, collection: true, publishedRevision: true },
  });
  return decodePublishedStudyEdition(edition);
}

/** Zelfde immutable validatie voor een rechtengestuurde batch; caller controleert normale rechten. */
export function decodePublishedStudyEdition(edition: Prisma.StudyLessonEditionGetPayload<{include:{lesson:true;collection:true;publishedRevision:true}}> | null): PublishedStudyDTO | null {
  const revision = edition?.publishedRevision;
  if (
    !edition ||
    !revision ||
    revision.lessonEditionId !== edition.id ||
    edition.workKey !== edition.lesson.workKey ||
    edition.workKey !== edition.collection.work
  )
    return null;
  const {lessonId,collectionId}=edition;
  // Zelfs een corrupte directe DB-insert is geen valide gepubliceerde inhoud.
  try {
    const content = validateStudyRevision({
      schemaVersion: revision.schemaVersion as 1,
      title: revision.title,
      body: revision.body,
      sourceMetadata:
        revision.sourceMetadata as StudyRevisionInput["sourceMetadata"],
      rightsMetadata:
        revision.rightsMetadata as StudyRevisionInput["rightsMetadata"],
    });
    if (studyRevisionHash(content) !== revision.contentHash) return null;
    return freeze({
      lessonId,
      workKey: edition.workKey,
      periodId: edition.lesson.periodId,
      sourceKey: edition.lesson.sourceKey,
      editionId: edition.id,
      collectionId,
      editionKey: edition.collection.editionKey,
      language: edition.collection.language,
      slug: edition.slug,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      schemaVersion: content.schemaVersion,
      contentHash: revision.contentHash,
      title: content.title,
      body: content.body,
    });
  } catch {
    return null;
  }
}

/** Metadata heeft dezelfde publicatiegate als de body; nooit losse conceptdetailqueries. */
export async function findPublishedLogicalLesson(
  actor: ContentActor | null,
  lessonId: string,
  collectionId: string,
  db: Pick<Prisma.TransactionClient, "studyLessonEdition"> = prisma,
) {
  const lesson = await getPublishedStudyLesson(
    actor,
    lessonId,
    collectionId,
    db,
  );
  return lesson
    ? freeze({
        id: lesson.lessonId,
        workKey: lesson.workKey,
        periodId: lesson.periodId,
        sourceKey: lesson.sourceKey,
      })
    : null;
}
export async function findPublishedLessonEdition(
  actor: ContentActor | null,
  lessonId: string,
  collectionId: string,
  db: Pick<Prisma.TransactionClient, "studyLessonEdition"> = prisma,
) {
  const lesson = await getPublishedStudyLesson(
    actor,
    lessonId,
    collectionId,
    db,
  );
  return lesson
    ? freeze({
        id: lesson.editionId,
        lessonId,
        collectionId,
        language: lesson.language,
        editionKey: lesson.editionKey,
        slug: lesson.slug,
      })
    : null;
}
