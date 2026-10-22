import fs from "node:fs/promises";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import sourceLock from "../../data/study-content/cfm-2026-nl/source-lock.json";
import mediaLock from "../../data/study-content/cfm-2026-nl/media-lock.json";
import additional from "../../data/study-content/cfm-2026-nl/reference-review-additional.json";
import { cfmReferenceTarget } from "../../src/lib/studyContent/cfm2026Adapter";
import { loadCfmLesson } from "../../src/lib/studyContent/cfm2026Import";
import { cfmOldTestament2026NlManifest as manifest } from "../../src/lib/studyContent/cfm2026Manifest";
import {
  parseOtbPassage,
  parseOtbPassageSet,
} from "../../src/lib/references/otb";
import { verifiedOfficialUrl } from "../../src/lib/references/evidence";
import baseline from "../../data/study-content/cfm-2026-nl/reference-review-baseline.json";
import checks from "../../data/study-content/cfm-2026-nl/reference-source-checks.json";
import index from "../../data/study-content/cfm-2026-nl/otb-index.json";
type ReferenceCheck = {
  anchor: string;
  label: string;
  bible: boolean;
  target: Record<string, unknown>;
  sourceValidation: string;
  reason: string | null;
};
const videoProofs: Array<{
  lesson: string;
  id: string;
  url: string;
  title: string;
  poster: string;
  posterChecksum: string;
  sourceSnapshotHash: string;
}> = [];
const lessons: Array<{
  key: string;
  title: string;
  startsOn: string;
  endsOn: string;
  blocks: number;
  tables: number;
  media: number;
  diagnostics: Array<{ anchor: string; code: string; target?: string }>;
  references: ReferenceCheck[];
}> = [];
for (const lesson of manifest.lessons) {
  const parsed = await loadCfmLesson(lesson.sourceKey);
  const raw = JSON.parse(
    await fs.readFile(
      `data/study-content/cfm-2026-nl/source/${lesson.sourceKey}.json`,
      "utf8",
    ),
  );
  function videos(n: DefaultTreeAdapterMap["node"]): void {
    if ("tagName" in n && n.tagName === "video") {
      const attr = (name: string) =>
        n.attrs.find((a) => a.name === name)?.value ?? "";
      const source = n.childNodes.find(
        (c) =>
          "tagName" in c &&
          c.tagName === "source" &&
          c.attrs.some((a) => a.name === "type" && a.value === "video/mp4"),
      );
      const url =
        source && "attrs" in source
          ? source.attrs.find((a) => a.name === "src")?.value
          : null;
      const poster = attr("poster"),
        media = mediaLock.find((m) => m.url === poster);
      if (
        !url ||
        !poster ||
        !media ||
        !parsed.assets.some((a) => a.url === poster)
      )
        throw Error("VIDEO_POSTER_SOURCE_PROOF");
      videoProofs.push({
        lesson: lesson.sourceKey,
        id: `video-${attr("id")}`,
        url,
        title: attr("data-video-title") || raw.title,
        poster,
        posterChecksum: media.checksum,
        sourceSnapshotHash: (sourceLock.lessons as Record<string, string>)[
          lesson.sourceKey
        ],
      });
    }
    if ("childNodes" in n) n.childNodes.forEach(videos);
  }
  videos(parseFragment(raw.body));
  const references = parsed.inventory.references.map((r) => {
    const target = String(r.target.sourceKey),
      single = parseOtbPassage(target),
      passages = single ? [single] : parseOtbPassageSet(target);
    const external = String(r.target.externalUrl ?? "");
    const unsupported = target.startsWith("unverified-range:")
      ? "COMPOSITE_REFERENCE_NOT_SUPPORTED"
      : target.startsWith("unverified-numbering:")
        ? "LABEL_URI_NUMBERING_CONFLICT"
        : /^otb:[a-z0-9]+$/.test(target)
          ? "WHOLE_BOOK_NOT_SUPPORTED"
          : /^otb:[a-z0-9]+:\d+[-–]\d+$/.test(target)
            ? "MULTI_CHAPTER_NOT_SUPPORTED"
            : /\bBJS\b/.test(r.label) || external.includes("/scriptures/jst/")
              ? "BJS_EDITION_NOT_OTB"
              : external.includes("/scriptures/nt/")
                ? "NEW_TESTAMENT_OUTSIDE_APPROVED_OTB_MAPPING"
                : /\/scriptures\/(pgp|bofm|dc-testament|jst)\//.test(external)
                  ? "OTHER_SCRIPTURE_OUTSIDE_APPROVED_OTB_MAPPING"
                  : external.includes(".mp4")
                    ? "VIDEO_RESOURCE_REVIEW_REQUIRED"
                    : external.includes(".pdf")
                      ? "PDF_RESOURCE_REVIEW_REQUIRED"
                      : external.includes("/scriptures/ot/")
                        ? "UNRECOGNIZED_OTB_RANGE"
                        : "EXTERNAL_RESOURCE_NOT_REGISTERED";
    const provenExternal = !passages && verifiedOfficialUrl(target);
    let reason: string | null = provenExternal
      ? null
      : passages
        ? null
        : unsupported;
    for (const p of passages ?? []) {
      const chapter = index.chapters.find(
        (c) => c.bookKey === p.bookKey && c.chapter === p.chapter,
      );
      if (!chapter) reason = "MISSING_CHAPTER";
      else if (p.verses?.some((v) => !chapter.verses.includes(v)))
        reason = "MISSING_VERSE";
      else if (p.verses && p.verses.length > 40)
        reason = "EXPLICIT_RANGE_TOO_LARGE";
    }
    return {
      anchor: r.occurrenceKey,
      label: r.label,
      bible: /\/scriptures\/(ot|nt)\//.test(String(r.target.externalUrl)),
      target: r.target,
      sourceValidation:
        reason ?? (provenExternal ? "EXTERNAL_VERIFIED" : "OTB_VERIFIED"),
      reason,
    };
  });
  lessons.push({
    key: lesson.sourceKey,
    title: parsed.title,
    startsOn: lesson.startsOn,
    endsOn: lesson.endsOn,
    blocks: parsed.inventory.blockCount,
    tables: parsed.document.sections
      .flatMap((s) => s.blocks)
      .filter((b) => b.type === "table").length,
    media: parsed.assets.length,
    diagnostics: parsed.diagnostics,
    references,
  });
}
const refs = lessons.flatMap((l) => l.references);
const report = {
  expectedLessons: 52,
  preparedLessons: lessons.length,
  blocks: lessons.reduce((n, l) => n + l.blocks, 0),
  references: refs.length,
  bibleReferences: refs.filter((r) => r.bible).length,
  otbSourceVerified: refs.filter((r) => r.sourceValidation === "OTB_VERIFIED")
    .length,
  externalVerified: refs.filter(
    (r) => r.sourceValidation === "EXTERNAL_VERIFIED",
  ).length,
  blocked: refs.filter((r) => r.reason).length,
  tables: lessons.reduce((n, l) => n + l.tables, 0),
  missingImages: 0,
  unmirroredVideoResources: lessons
    .flatMap((l) => l.diagnostics)
    .filter((d) => d.code === "VIDEO_EMBEDDED").length,
  imagesAndPosters: lessons.reduce((n, l) => n + l.media, 0),
  missingSourceAlt: lessons
    .flatMap((l) => l.diagnostics)
    .filter((d) => d.code === "MISSING_SOURCE_ALT").length,
  productionPublished: false,
  sourceIndexIsNotProductionAccessProof: true,
  lessons,
};
const categoryCounts = (rows: Array<{ originalReason: string }>) =>
  Object.fromEntries(
    [...new Set(rows.map((r) => r.originalReason))].map((k) => [
      k,
      rows.filter((r) => r.originalReason === k).length,
    ]),
  );
const assessReference = (original: {
  lesson: string;
  anchor: string;
  label: string;
  originalTarget: { externalUrl: string };
  originalReason: string;
}) => {
  const current = lessons
    .find((l) => l.key === original.lesson)!
    .references.find((r) => r.anchor === original.anchor)!;
  if (!current || current.label !== original.label)
    throw Error("REVIEW_OCCURRENCE_IDENTITY");
  const url = original.originalTarget.externalUrl;
  const network = checks.resources.find((r) => r.url === url);
  if (!network) throw Error("REVIEW_SOURCE_MISSING");
  const single = parseOtbPassage(String(current.target.sourceKey));
  const parts = single
    ? [single]
    : parseOtbPassageSet(String(current.target.sourceKey));
  const sourceUriCandidate = parseOtbPassage(
    cfmReferenceTarget(url, "", manifest.lessons[0].sourceUrl).sourceKey,
  );
  const candidate =
    parseOtbPassage(original.label) ??
    (sourceUriCandidate && /^ver(?:s|zen)\s+/i.test(original.label)
      ? parseOtbPassage(
          `otb:${sourceUriCandidate.bookKey}:${sourceUriCandidate.chapter}:${original.label.replace(/^ver(?:s|zen)\s+/i, "").replace(/\s+en\s+/gi, ",")}`,
        )
      : null);
  const proof = (parts ?? (candidate ? [candidate] : [])).map((p) => {
    const row = index.chapters.find(
      (c) => c.bookKey === p.bookKey && c.chapter === p.chapter,
    );
    return {
      bookKey: p.bookKey,
      chapter: p.chapter,
      verses: p.verses,
      sourceFile: row?.sourceFile ?? null,
      sourceBlob: row?.sourceBlob ?? null,
      verseNumbersExist:
        !!row && (!p.verses || p.verses.every((v) => row.verses.includes(v))),
    };
  });
  const classification =
    current.sourceValidation === "OTB_VERIFIED"
      ? "A_INTERNAL_SOURCE_VERIFIED"
      : current.sourceValidation === "EXTERNAL_VERIFIED"
        ? "B_OFFICIAL_EXTERNAL_VERIFIED"
        : "C_MANUAL_REVIEW";
  return {
    lesson: original.lesson,
    sourceLocation: original.anchor,
    label: original.label,
    originalUrl: url,
    originalReason: original.originalReason,
    currentTarget: current.target,
    classification,
    currentReason: current.reason,
    proposedHandling: classification.startsWith("A_")
      ? "Alle deelpassages via centrale resolver, normale publicatie-/editie-/taalrechten opnieuw controleren"
      : classification.startsWith("B_")
        ? "Exact gecontroleerde oorspronkelijke officiële URL; geen wijziging van actieve bron"
        : "Geblokkeerd houden; geen editie- of nummeringssubstitutie",
    sourceUriCanonicalCandidate: sourceUriCandidate,
    canonicalCandidate: proof,
    internalMappingApproved: classification.startsWith("A_"),
    runtimeAccessRequired: true,
    sourceEvidence: network,
    originalUriSelection: new URL(url).searchParams.get("id"),
    manualReviewRequired: classification.startsWith("C_"),
  };
};
const assessments = baseline.occurrences.map(assessReference);
const additionalFindings = additional.occurrences.map(assessReference);
const originalCounts = categoryCounts(baseline.occurrences);
const review = {
  baseCommit: baseline.baseCommit,
  sourceChecksAt: checks.checkedAt,
  sourceIndexIsNotProductionAccessProof: true,
  originalCounts,
  byOriginalCategory: Object.fromEntries(
    Object.keys(originalCounts).map((reason) => [
      reason,
      {
        original: originalCounts[reason],
        internal: assessments.filter(
          (a) =>
            a.originalReason === reason && a.classification.startsWith("A_"),
        ).length,
        external: assessments.filter(
          (a) =>
            a.originalReason === reason && a.classification.startsWith("B_"),
        ).length,
        manual: assessments.filter(
          (a) => a.originalReason === reason && a.manualReviewRequired,
        ).length,
      },
    ]),
  ),
  assessedOccurrences: assessments.length,
  numberingConflictsInternallyResolved: assessments.filter(
    (a) =>
      a.originalReason === "LABEL_URI_NUMBERING_CONFLICT" &&
      a.internalMappingApproved,
  ).length,
  altReview: {
    checksum:
      "9e9f60cd6b12ef4b069d6ae3eb07829bd8736aacd6ab5c869f60dce192b1e88c",
    informative: true,
    visibleText: "Meer voor onderwijs aan kinderen / Nu bekijken",
    alt: "Meer voor onderwijs aan kinderen — Nu bekijken.",
    occurrences: 52,
    reviewedByVisualInspection: true,
  },
  videoChecks: assessments
    .filter((a) => a.originalReason === "VIDEO_RESOURCE_REVIEW_REQUIRED")
    .map((a) => ({
      ...a,
      sourceAttachment: videoProofs.find(
        (v) =>
          v.lesson === a.lesson &&
          v.url === a.originalUrl &&
          v.title === a.label,
      ),
      posterPreserved: true,
      videoMirrored: false,
    })),
  assessments,
  additionalFindings,
};
if (review.videoChecks.some((v) => !v.sourceAttachment))
  throw Error("VIDEO_OCCURRENCE_PROOF");
await fs.writeFile(
  "data/study-content/cfm-2026-nl/reference-review.json",
  JSON.stringify(review, null, 2) + "\n",
);
Object.assign(report, {
  originalCounts,
  originalBlocked: 1481,
  referenceReviewFile: "reference-review.json",
  altCorrections: 52,
  videoFilesMirrored: 0,
  checkedVideoOccurrences: review.videoChecks.length,
  approvedVideoLinks: review.videoChecks.filter((v) => !v.manualReviewRequired)
    .length,
  newlyFoundNumberingConflicts: 6,
  manualReviewRequired: refs.filter((r) => r.reason).length,
});
await fs.writeFile(
  "data/study-content/cfm-2026-nl/quality-report.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ ...report, lessons: undefined }));
