import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { authorizedReadingRevision } from "@/lib/studyContent/readingPosition";
import {
  getPublishedStudyLesson,
  decodePublishedStudyEdition,
  type PublishedStudyDTO,
} from "@/lib/studyContent/revisions";
import { studyDocumentInventory } from "@/lib/studyContent/fixtureAdapter";
import { studyObjectHash } from "@/lib/studyContent/policy";
import { parseStudyDocument } from "@/lib/studyContent/schema";
import {
  chapterEvidenceHash,
  parseScriptureUrl,
  verifiedOfficialUrl,
  referenceEvidenceVersion,
} from "./evidence";
import officialResources from "./official-resources.json";
import {
  referenceRequestSchema,
  type ReferenceRequest,
  type ReferenceResolution,
} from "./contract";
export type ReferenceActor = { id: string; isAdmin: boolean };
export const MAX_PREVIEW_VERSES = 40;
export const MAX_PREVIEW_BYTES = 48_000;
function bounded(result: ReferenceResolution): boolean {
  return Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_PREVIEW_BYTES;
}
type ChapterProof = {
  id: string;
  number: number;
  verses: Array<{ number: number; text: string }>;
  book: {
    key: string | null;
    name: string;
    contentCollection: {
      id: string;
      work: string | null;
      editionKey: string;
      language: string;
    };
  };
};
type PreparedChapters = Map<string, ChapterProof>;
type PreparedStudy = Map<
  string,
  {
    published: PublishedStudyDTO;
    media: Array<{ mediaKey: string; mediaId: string }>;
  }
>;
function studyIdentity(
  origin: Pick<PublishedStudyDTO, "workKey" | "editionKey" | "language">,
  target: Record<string, unknown>,
) {
  const key = typeof target.sourceKey === "string" ? target.sourceKey : "";
  if (!key.startsWith("study:")) return null;
  const parts = key.slice(6).split("#");
  if (parts.length > 2 || !parts[0] || parts[0].length > 512) return null;
  const work =
    typeof target.workKey === "string" ? target.workKey : origin.workKey;
  const family =
    typeof target.editionKey === "string"
      ? target.editionKey
      : work === origin.workKey
        ? origin.editionKey
        : null;
  const language =
    typeof target.language === "string"
      ? target.language
      : work === origin.workKey
        ? origin.language
        : null;
  return family && language
    ? {
        sourceKey: parts[0],
        section: parts[1],
        work,
        family,
        language,
        key: JSON.stringify([work, parts[0], family, language]),
      }
    : null;
}
const proofKey = (bookKey: string, chapter: number) => `${bookKey}:${chapter}`;

/** Eén adaptercontract voor importreview en gewone, lazy gebruikerspreviews. */
export async function resolveReferenceTarget(
  db: Prisma.TransactionClient,
  actor: ReferenceActor,
  origin: Pick<
    PublishedStudyDTO,
    "workKey" | "editionKey" | "language" | "collectionId"
  >,
  target: Record<string, unknown>,
  diagnosticKey: string,
  prepared?: PreparedChapters,
  studies?: PreparedStudy,
): Promise<ReferenceResolution> {
  const sourceKey =
    typeof target.sourceKey === "string" ? target.sourceKey : "";
  // Een bekend maar ongerelateerd extern doel bewijst geen fallback. Behoud
  // de oorspronkelijke bewezen URL of een exact geregistreerde bronalias.
  const fallback =
    verifiedOfficialUrl(sourceKey) ??
    officialResources.find(
      (r) => r.path === sourceKey && r.url === target.externalUrl,
    )?.url ??
    null;
  const fail = (
    reason: Extract<ReferenceResolution, { kind: "unavailable" }>["reason"],
  ): ReferenceResolution =>
    fallback
      ? { kind: "external", url: fallback, diagnosticKey }
      : { kind: "unavailable", reason, diagnosticKey };
  const passage = parseScriptureUrl(sourceKey);
  if (passage) {
    // Expliciete bronmetadata is noodzakelijk; een URL of vertaalde naam alleen
    // bewijst niet dat de les deze lokale teksteditie bedoelt.
    if (
      target.workKey !== passage.book.work ||
      target.editionKey !== passage.book.editionKey ||
      target.language !== "nl" ||
      passage.language !== "nl"
    )
      return fail("edition");
    const cached = prepared?.get(proofKey(passage.bookKey, passage.chapter));
    const collection = prepared
      ? cached?.book.contentCollection
      : await db.contentCollection.findFirst({
          where: {
            ...readingAccessWhere(actor),
            work: passage.book.work,
            editionKey: passage.book.editionKey,
            language: "nl",
            contentWork: { kind: "SCRIPTURE" },
          },
          select: { id: true, work: true, editionKey: true, language: true },
        });
    if (!collection) return fail("missing");
    const chapter = prepared
      ? cached
      : await db.chapter.findFirst({
          where: {
            number: passage.chapter,
            book: { contentCollectionId: collection.id, key: passage.bookKey },
          },
          select: {
            id: true,
            book: { select: { name: true } },
            verses: {
              orderBy: { number: "asc" },
              take: 501,
              select: { number: true, text: true },
            },
          },
        });
    const proof = passage.book.chapters[String(passage.chapter)];
    if (
      !chapter ||
      chapter.verses.length !== proof.verses ||
      chapterEvidenceHash(chapter.verses) !== proof.hash
    )
      return fail("unverified");
    if (passage.to - passage.from + 1 > MAX_PREVIEW_VERSES)
      return fail("too-large");
    const result: ReferenceResolution = {
      kind: "internal",
      diagnosticKey,
      collectionId: collection.id,
      work: passage.book.work,
      editionKey: collection.editionKey,
      language: collection.language,
      title: `${chapter.book.name} ${passage.chapter}:${passage.from}${passage.to === passage.from ? "" : `–${passage.to}`}`,
      href: `/scripture/${encodeURIComponent(chapter.id)}#vers-${passage.from}`,
      preview: {
        kind: "scripture",
        chapterId: chapter.id,
        verses: chapter.verses.filter(
          (v) => v.number >= passage.from && v.number <= passage.to,
        ),
      },
    };
    return bounded(result) ? result : fail("too-large");
  }
  if (sourceKey.startsWith("study:")) {
    const identity = studyIdentity(origin, target);
    if (!identity) return fail("edition");
    const { work, family, language, sourceKey: logical, section } = identity;
    const cached = studies?.get(identity.key);
    let published = cached?.published ?? null;
    let collectionId = published?.collectionId ?? null;
    if (!studies) {
      const lessons = await db.studyLesson.findMany({
        where: { workKey: work, sourceKey: logical },
        take: 2,
        select: { id: true },
      });
      const collection = await db.contentCollection.findFirst({
        where: {
          work,
          editionKey: family,
          language,
          ...readingAccessWhere(actor),
        },
        select: { id: true },
      });
      published =
        lessons.length === 1 && collection
          ? await getPublishedStudyLesson(
              actor,
              lessons[0].id,
              collection.id,
              db,
            )
          : null;
      collectionId = collection?.id ?? null;
    }
    if (!published || !collectionId) return fail("missing");
    const sections = section
      ? published.body.sections.filter((s) => s.id === section)
      : [...published.body.sections];
    if (!sections.length) return fail("missing");
    const media =
      cached?.media ??
      (await db.studyRevisionMedia.findMany({
        where: { revisionId: published.revisionId, media: { status: "READY" } },
        take: 100,
        select: { mediaKey: true, mediaId: true },
      }));
    const result: ReferenceResolution = {
      kind: "internal",
      diagnosticKey,
      collectionId,
      work,
      editionKey: family,
      language,
      title: published.title,
      href: `/study-lesson/${encodeURIComponent(published.lessonId)}/${encodeURIComponent(published.collectionId)}${section ? `#${section}` : ""}`,
      preview: {
        kind: "study",
        document: { schemaVersion: 1, sections: structuredClone(sections) },
        media,
      },
    };
    return bounded(result) ? result : fail("too-large");
  }
  const official = verifiedOfficialUrl(sourceKey);
  return official
    ? { kind: "external", url: official, diagnosticKey }
    : fail("unverified");
}

/** Eén gerichte hoofdstukquery voor import/publicatiereview, geen query per versref. */
export async function resolveReferenceBatch(
  db: Prisma.TransactionClient,
  actor: ReferenceActor,
  origin: Pick<
    PublishedStudyDTO,
    "workKey" | "editionKey" | "language" | "collectionId"
  >,
  references: Array<{ target: Record<string, unknown>; diagnosticKey: string }>,
) {
  if (references.length > 200) throw new Error("REFERENCE_LIMIT");
  const passages = references
    .map((r) =>
      parseScriptureUrl(
        typeof r.target.sourceKey === "string" ? r.target.sourceKey : "",
      ),
    )
    .filter((p) => p && p.language === "nl");
  const clauses = [
    ...new Map(
      passages.map((p) => [
        proofKey(p!.bookKey, p!.chapter),
        {
          number: p!.chapter,
          book: {
            key: p!.bookKey,
            contentCollection: {
              ...readingAccessWhere(actor),
              work: p!.book.work,
              editionKey: p!.book.editionKey,
              language: "nl",
              contentWork: { kind: "SCRIPTURE" as const },
            },
          },
        },
      ]),
    ).values(),
  ];
  const rows = clauses.length
    ? await db.chapter.findMany({
        where: { OR: clauses },
        take: 200,
        select: {
          id: true,
          number: true,
          book: {
            select: {
              key: true,
              name: true,
              contentCollection: {
                select: {
                  id: true,
                  work: true,
                  editionKey: true,
                  language: true,
                },
              },
            },
          },
          verses: {
            orderBy: { number: "asc" },
            take: 501,
            select: { number: true, text: true },
          },
        },
      })
    : [];
  const prepared: PreparedChapters = new Map(),
    ambiguous = new Set<string>();
  for (const row of rows) {
    const key = proofKey(row.book.key!, row.number);
    if (prepared.has(key)) {
      prepared.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) prepared.set(key, row);
  }
  const identities = [
    ...new Map(
      references
        .map((r) => studyIdentity(origin, r.target))
        .filter((i) => i !== null)
        .map((i) => [i.key, i]),
    ).values(),
  ];
  const studies: PreparedStudy = new Map(),
    duplicates = new Set<string>();
  if (identities.length && identities.length <= 20) {
    const logicalLessons = await db.studyLesson.findMany({
      where: {
        OR: identities.map((i) => ({
          workKey: i.work,
          sourceKey: i.sourceKey,
        })),
      },
      take: 41,
      select: { workKey: true, sourceKey: true },
    });
    const counts = new Map<string, number>();
    for (const lesson of logicalLessons) {
      const key = JSON.stringify([lesson.workKey, lesson.sourceKey]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const editions = await db.studyLessonEdition.findMany({
      where: {
        publishedRevisionId: { not: null },
        collection: readingAccessWhere(actor),
        lesson: { retiredAt: null, work: { kind: "STUDY_PROGRAM" } },
        OR: identities.map((i) => ({
          workKey: i.work,
          lesson: { sourceKey: i.sourceKey },
          collection: {
            work: i.work,
            editionKey: i.family,
            language: i.language,
          },
        })),
      },
      take: 41,
      include: {
        lesson: true,
        collection: true,
        publishedRevision: {
          include: {
            media: {
              where: { media: { status: "READY" } },
              take: 100,
              select: { mediaKey: true, mediaId: true },
            },
          },
        },
      },
    });
    // Een overschreden limiet of meerdere lesjaren met dezelfde bronkey is onduidelijk.
    if (editions.length <= 40 && logicalLessons.length <= 40)
      for (const edition of editions) {
        const published = decodePublishedStudyEdition(edition);
        if (
          !published ||
          counts.get(
            JSON.stringify([published.workKey, published.sourceKey]),
          ) !== 1
        )
          continue;
        const key = JSON.stringify([
          published.workKey,
          published.sourceKey,
          published.editionKey,
          published.language,
        ]);
        if (studies.has(key)) {
          studies.delete(key);
          duplicates.add(key);
        } else if (!duplicates.has(key))
          studies.set(key, {
            published,
            media: edition.publishedRevision!.media,
          });
      }
  }
  const results: ReferenceResolution[] = [];
  for (const ref of references)
    results.push(
      await resolveReferenceTarget(
        db,
        actor,
        origin,
        ref.target,
        ref.diagnosticKey,
        prepared,
        studies,
      ),
    );
  return results;
}

export async function referenceInTransaction(
  db: Prisma.TransactionClient,
  actor: ReferenceActor,
  request: ReferenceRequest,
  sessionKey: string,
) {
  const origin = await authorizedReadingRevision(
    db,
    actor,
    request.lessonEditionId,
    request.revisionId,
    sessionKey,
    request.visitProof,
  );
  const source = studyDocumentInventory(
    parseStudyDocument(origin.body),
  ).references.find((r) => r.occurrenceKey === request.occurrenceKey);
  const row =
    source &&
    (await db.contentReference.findUnique({
      where: {
        revisionId_occurrenceKey: {
          revisionId: request.revisionId,
          occurrenceKey: request.occurrenceKey,
        },
      },
    }));
  if (
    !source ||
    !row ||
    row.label !== source.label ||
    studyObjectHash(row.originalTarget) !== studyObjectHash(source.target)
  )
    throw new Error("REFERENCE_UNAVAILABLE");
  const [result] = await resolveReferenceBatch(db, actor, origin.lesson, [
    { target: source.target, diagnosticKey: row.id },
  ]);
  return { origin: origin.lesson, result };
}
export async function resolveStudyReference(
  actor: ReferenceActor,
  raw: ReferenceRequest,
  sessionKey: string,
  client: PrismaClient = prisma,
) {
  const input = referenceRequestSchema.parse(raw);
  return client.$transaction(
    async (db) => {
      await db.$executeRaw`SET TRANSACTION READ ONLY`;
      await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
      return (await referenceInTransaction(db, actor, input, sessionKey))
        .result;
    },
    { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 10000 },
  );
}
export function referenceDiagnosis(result: ReferenceResolution) {
  return {
    diagnosis:
      result.kind === "internal"
        ? "INTERNAL_VERIFIED"
        : result.kind === "external"
          ? "EXTERNAL_VERIFIED"
          : "UNRESOLVED",
    evidenceKey:
      result.kind === "unavailable" ? null : referenceEvidenceVersion,
  };
}
export function normalizedReference(result: ReferenceResolution) {
  if (result.kind === "unavailable")
    return { kind: result.kind, reason: result.reason };
  if (result.kind === "external") return { kind: result.kind, url: result.url };
  return {
    kind: result.kind,
    collectionId: result.collectionId,
    work: result.work,
    editionKey: result.editionKey,
    language: result.language,
    href: result.href,
  };
}
