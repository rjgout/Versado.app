import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { referenceDiagnosis, resolveReferenceBatch } from "@/lib/references/resolver";
import review from "../../../data/study-content/cfm-2026-nl/reference-review.json";
import sourceLock from "../../../data/study-content/cfm-2026-nl/source-lock.json";
import { cfmDisplayOnlyKeys } from "./cfmReview";
import { cfmOldTestament2026NlManifest as manifest, matchesCfm2026Catalogue } from "./cfm2026Manifest";
import { studyDocumentInventory } from "./fixtureAdapter";
import { validateStoredStudyRevision } from "./publication";
import { requireStudyAdmin, studyObjectHash, studyReleaseAllowed, StudyPublishingError, type StudyAdmin } from "./policy";
import { readStudyMedia, validateStudyMediaMetadata } from "./storage";

// Eén voorcontrole voor het hele studieprogramma. Zij gebruikt dezelfde primitieven als publishStudyRevision
// (mediabinding, manifestpin, bytecontrole, centrale referentieresolver, exacte CFM-lijst), maar is zelf nooit
// de laatste poort: publishStudyRevision herhaalt alles per les. Een voorcontrole is dus geen beoordeling.

/** Codes in plaats van vrije tekst: de beheerpagina vertaalt ze, het (Nederlandse) verslag heeft een eigen tekst per code. */
export type ReviewIssueCode = "CONTENT" | "IMPORT" | "IMPORT_CLOSED" | "SOURCE" | "MEDIA" | "ALT" | "REFERENCE_UNKNOWN" | "REFERENCE_UNPROVEN" | "REFERENCE_MISMATCH" | "CATALOGUE" | "INCOMPLETE";
export type ReviewIssue = { code: ReviewIssueCode; ref?: string; count?: number };
export type LessonReviewStatus = "published" | "ready" | "blocked" | "missing";
export type LessonReview = {
  editionId: string;
  lessonId: string;
  sourceKey: string;
  order: number;
  title: string;
  period: string;
  status: LessonReviewStatus;
  /** Gecontroleerde revisie: de concept-revisie, anders de gepubliceerde. */
  revisionId: string | null;
  revisionNumber: number | null;
  contentHash: string | null;
  publishedRevisionId: string | null;
  publicationVersion: number;
  importRunId: string | null;
  sourceVersion: string | null;
  sourceUrl: string | null;
  blocks: number;
  media: { figures: number; ready: number; missing: number; altMissing: number };
  references: { total: number; verified: number; displayOnly: number; blocking: number };
  displayOnlyKeys: string[];
  issues: ReviewIssue[];
};
export type ProgramReview = {
  collectionId: string;
  name: string;
  work: string | null;
  editionKey: string | null;
  language: string;
  sourceName: string | null;
  sourceUrl: string | null;
  licenseName: string | null;
  adapter: string | null;
  sourceVersion: string | null;
  publicationState: string;
  visibleToUsers: boolean;
  catalogueValid: boolean;
  expected: number;
  imported: number;
  published: number;
  /** Nog niet gepubliceerde, volledig bruikbare concepten. */
  ready: number;
  blocked: number;
  missing: number;
  totals: {
    figures: number;
    mediaReady: number;
    mediaMissing: number;
    altMissing: number;
    references: number;
    referencesVerified: number;
    displayOnly: number;
    blocking: number;
  };
  lessons: LessonReview[];
  /** Identiteit van de beoordeelde set; de server vergelijkt dit bij publicatie opnieuw. */
  reviewToken: string;
  controlLists: { referenceReview: string | null; sourceLock: string | null };
  generatedAt: string;
};

/** Alleen identiteiten en controlelijsten, geen uitkomsten: wat de beheerder beoordeelde is deze set revisies. */
export function reviewSetToken(input: {
  collectionId: string;
  lessons: Array<Pick<LessonReview, "editionId" | "lessonId" | "sourceKey" | "order" | "revisionId" | "contentHash" | "importRunId">>;
  controlLists: { referenceReview: string | null; sourceLock: string | null };
}) {
  return studyObjectHash({
    collectionId: input.collectionId,
    controlLists: input.controlLists,
    lessons: input.lessons.map((l) => [l.editionId, l.lessonId, l.sourceKey, l.order, l.revisionId, l.contentHash, l.importRunId]),
  });
}
function cfmControlLists(adapter: string | null) {
  return adapter === "cfm-2026-nl-v1"
    ? { referenceReview: studyObjectHash(review), sourceLock: studyObjectHash(sourceLock) }
    : { referenceReview: null, sourceLock: null };
}

type Db = PrismaClient;
const REVIEW_CONCURRENCY = 4;
const lessonInclude = {
  lesson: { include: { period: { select: { label: true } } } },
  publishedRevision: { include: { media: { include: { media: true } }, references: true } },
  draftRevision: { include: { media: { include: { media: true } }, references: true } },
} as const;

async function reviewLesson(
  db: Db,
  actor: StudyAdmin,
  edition: Awaited<ReturnType<typeof loadEditions>>[number],
  collection: { id: string; editionKey: string | null; language: string },
  runs: Map<string, { id: string; adapterName: string; sourceVersion: string }>,
): Promise<LessonReview> {
  const draft = edition.draftRevision, published = edition.publishedRevision;
  const revision = draft ?? published;
  const base = {
    editionId: edition.id, lessonId: edition.lessonId, sourceKey: edition.lesson.sourceKey ?? edition.slug, order: edition.lesson.order,
    period: edition.lesson.period.label, publishedRevisionId: edition.publishedRevisionId, publicationVersion: edition.publicationVersion,
  };
  const empty = { blocks: 0, media: { figures: 0, ready: 0, missing: 0, altMissing: 0 }, references: { total: 0, verified: 0, displayOnly: 0, blocking: 0 }, displayOnlyKeys: [] as string[] };
  if (!revision) {
    return { ...base, title: edition.slug, status: "missing", revisionId: null, revisionNumber: null, contentHash: null, importRunId: null, sourceVersion: null, sourceUrl: null, ...empty, issues: [{ code: "INCOMPLETE" }] };
  }
  const issues: ReviewIssue[] = [];
  const result: LessonReview = {
    ...base, title: revision.title, status: draft ? "ready" : "published", revisionId: revision.id, revisionNumber: revision.revisionNumber,
    contentHash: revision.contentHash, importRunId: null, sourceVersion: null, sourceUrl: null, ...empty, issues,
  };
  let content;
  try {
    content = validateStoredStudyRevision(revision);
  } catch {
    issues.push({ code: "CONTENT" });
    result.status = "blocked";
    return result;
  }
  result.sourceUrl = content.sourceMetadata.url ?? null;
  const inventory = studyDocumentInventory(content.body);
  result.blocks = inventory.blockCount;
  const figureKeys = [...new Set(inventory.figures.map((f) => f.mediaKey))];
  result.media.figures = figureKeys.length;
  result.media.altMissing = inventory.emptyAltFigures;
  result.references.total = inventory.references.length;
  const run = runs.get(revision.id);
  result.importRunId = run?.id ?? null;
  result.sourceVersion = run?.sourceVersion ?? null;
  // Een al gepubliceerde les wordt alleen samengevat: zij is eerder volledig gepubliceerd en blijft onveranderd.
  const pending = Boolean(draft);
  if (pending && !run) issues.push({ code: "IMPORT" });
  if (pending && run && !studyReleaseAllowed(run.adapterName)) issues.push({ code: "IMPORT_CLOSED" });
  if (inventory.emptyAltFigures > 0) issues.push({ code: "ALT", count: inventory.emptyAltFigures });
  for (const key of figureKeys) {
    const figure = inventory.figures.find((f) => f.mediaKey === key)!;
    const binding = revision.media.find((m) => m.mediaKey === key);
    let ok = Boolean(binding && binding.media.status === "READY" && binding.media.width === figure.width && binding.media.height === figure.height);
    if (ok && binding) {
      const pin = content.sourceMetadata.mediaManifest?.find((m) => m.mediaKey === key);
      ok = Boolean(pin && pin.checksum === binding.media.checksum && pin.mimeType === binding.media.mimeType && pin.rightsHash === studyObjectHash(binding.media.rightsMetadata));
      if (ok) {
        try {
          validateStudyMediaMetadata(binding.media);
          // Bytes alleen bij nog te publiceren lessen: gepubliceerde lessen zijn bij hun publicatie volledig gecontroleerd
          // en de collectievrijgave controleert alle bytes opnieuw. Dat houdt een hervatting snel.
          if (pending) await readStudyMedia(binding.media, true);
        } catch {
          ok = false;
        }
      }
    }
    if (ok) result.media.ready++;
    else {
      result.media.missing++;
      issues.push({ code: "MEDIA", ref: key });
    }
  }
  if (revision.media.length !== figureKeys.length || revision.references.length !== inventory.references.length)
    issues.push({ code: "INCOMPLETE" });
  // Verwijzingen: dezelfde beslissing als publishStudyRevision, met de exacte gecontroleerde CFM-lijst.
  let displayOnly: string[] = [];
  if (pending && run?.adapterName === "cfm-2026-nl-v1") {
    try {
      displayOnly = await cfmDisplayOnlyKeys(content.sourceMetadata.sourceKey, content, run.sourceVersion);
    } catch {
      issues.push({ code: "SOURCE" });
    }
  }
  const actuals = pending
    ? await db.$transaction((tx) => resolveReferenceBatch(tx, actor, { workKey: edition.workKey, collectionId: collection.id, editionKey: collection.editionKey ?? "", language: collection.language }, inventory.references.map((r) => ({ target: r.target, diagnosticKey: r.occurrenceKey }))))
    : null;
  for (const [index, reference] of inventory.references.entries()) {
    const audit = revision.references.find((r) => r.occurrenceKey === reference.occurrenceKey);
    if (!pending) {
      if (audit && ["INTERNAL_VERIFIED", "EXTERNAL_VERIFIED"].includes(audit.diagnosis)) result.references.verified++;
      else result.references.displayOnly++;
      continue;
    }
    const actual = actuals![index];
    const sameTarget = audit && studyObjectHash(audit.originalTarget) === studyObjectHash(reference.target);
    if (actual.kind === "unavailable" && displayOnly.includes(reference.occurrenceKey)) {
      if (sameTarget) {
        result.references.displayOnly++;
        result.displayOnlyKeys.push(reference.occurrenceKey);
      } else {
        result.references.blocking++;
        issues.push({ code: "REFERENCE_MISMATCH", ref: reference.label });
      }
      continue;
    }
    const verified = referenceDiagnosis(actual);
    const ok = audit?.evidenceKey === "synthetic-reviewed-reference-v1"
      ? audit.diagnosis === "EXTERNAL_VERIFIED" && Boolean(sameTarget)
      : Boolean(audit && actual.kind !== "unavailable" && audit.diagnosis === verified.diagnosis && audit.evidenceKey === verified.evidenceKey && sameTarget);
    if (ok) result.references.verified++;
    else {
      result.references.blocking++;
      issues.push({ code: actual.kind === "unavailable" ? "REFERENCE_UNKNOWN" : "REFERENCE_UNPROVEN", ref: reference.label });
    }
  }
  if (pending) result.status = issues.length ? "blocked" : "ready";
  else if (issues.length) result.status = "blocked";
  return result;
}

async function loadEditions(db: Db, collectionId: string) {
  return db.studyLessonEdition.findMany({
    where: { collectionId, lesson: { work: { kind: "STUDY_PROGRAM" } } },
    orderBy: [{ lesson: { order: "asc" } }, { id: "asc" }],
    include: lessonInclude,
  });
}

/** Volledige, begrensde voorcontrole van één studieprogramma (alle lessen). Alleen voor beheerders. */
export async function studyProgramReview(actor: StudyAdmin, collectionId: string, client: Db = prisma): Promise<ProgramReview> {
  requireStudyAdmin(actor);
  const collection = await client.contentCollection.findFirst({
    where: { id: collectionId, ...readingAccessWhere(actor, "admin-preview"), contentWork: { kind: "STUDY_PROGRAM" } },
  });
  if (!collection) throw new StudyPublishingError("UNAVAILABLE");
  const editions = await loadEditions(client, collection.id);
  const catalogueValid = collection.work !== manifest.workKey || matchesCfm2026Catalogue(collection, editions);
  const revisionIds = editions.flatMap((e) => (e.draftRevisionId ?? e.publishedRevisionId ? [(e.draftRevisionId ?? e.publishedRevisionId)!] : []));
  const items = revisionIds.length
    ? await client.contentImportItem.findMany({
        where: { revisionId: { in: revisionIds }, run: { status: "DRAFT_READY", collectionId: collection.id } },
        orderBy: { createdAt: "desc" },
        include: { run: { select: { id: true, adapterName: true, sourceVersion: true } } },
      })
    : [];
  const runs = new Map<string, { id: string; adapterName: string; sourceVersion: string }>();
  for (const item of items) if (item.revisionId && !runs.has(item.revisionId)) runs.set(item.revisionId, item.run);
  const lessons: LessonReview[] = [];
  // Beperkt parallel (volgorde blijft die van de lessen): de bytecontrole en verwijzingsresolutie zijn de dure delen.
  for (let i = 0; i < editions.length; i += REVIEW_CONCURRENCY)
    lessons.push(...(await Promise.all(editions.slice(i, i + REVIEW_CONCURRENCY).map((edition) => reviewLesson(client, actor, edition, collection, runs)))));
  if (!catalogueValid) for (const lesson of lessons) {
    lesson.issues.push({ code: "CATALOGUE" });
    if (lesson.status !== "missing") lesson.status = "blocked";
  }
  const adapter = [...runs.values()][0]?.adapterName ?? (collection.work === manifest.workKey ? "cfm-2026-nl-v1" : null);
  const controlLists = cfmControlLists(adapter);
  const total = (pick: (l: LessonReview) => number) => lessons.reduce((n, l) => n + pick(l), 0);
  const manifestCount = collection.work === manifest.workKey ? manifest.lessons.length : editions.length;
  return {
    collectionId: collection.id,
    name: collection.name,
    work: collection.work,
    editionKey: collection.editionKey,
    language: collection.language,
    sourceName: collection.sourceName ?? null,
    sourceUrl: collection.sourceUrl ?? null,
    licenseName: collection.licenseName ?? null,
    adapter,
    sourceVersion: [...runs.values()][0]?.sourceVersion ?? null,
    publicationState: collection.publicationState,
    visibleToUsers: collection.visibleToUsers,
    catalogueValid,
    expected: manifestCount,
    imported: lessons.filter((l) => l.status !== "missing").length,
    published: lessons.filter((l) => l.status === "published").length,
    ready: lessons.filter((l) => l.status === "ready").length,
    blocked: lessons.filter((l) => l.status === "blocked").length,
    missing: lessons.filter((l) => l.status === "missing").length,
    totals: {
      figures: total((l) => l.media.figures),
      mediaReady: total((l) => l.media.ready),
      mediaMissing: total((l) => l.media.missing),
      altMissing: total((l) => l.media.altMissing),
      references: total((l) => l.references.total),
      referencesVerified: total((l) => l.references.verified),
      displayOnly: total((l) => l.references.displayOnly),
      blocking: (catalogueValid ? 0 : 1) + total((l) => l.references.blocking) + total((l) => l.issues.filter((i) => !i.code.startsWith("REFERENCE")).length),
    },
    lessons,
    reviewToken: reviewSetToken({ collectionId: collection.id, lessons, controlLists }),
    controlLists,
    generatedAt: new Date().toISOString(),
  };
}

/** Een stabiele UUID per (batch, les, revisie): een herhaling na een onderbreking is dezelfde actie. */
export function batchActionId(batchId: string, editionId: string, revisionId: string) {
  const hex = createHash("sha256").update(`${batchId}:${editionId}:${revisionId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}
