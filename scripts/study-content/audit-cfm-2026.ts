import fs from "node:fs/promises";
import { loadCfmLesson } from "../../src/lib/studyContent/cfm2026Import";
import { cfmOldTestament2026NlManifest as manifest } from "../../src/lib/studyContent/cfm2026Manifest";
import { parseOtbPassage } from "../../src/lib/references/otb";
import { verifiedOfficialUrl } from "../../src/lib/references/evidence";
import index from "../../data/study-content/cfm-2026-nl/otb-index.json";
const lessons = [];
for (const lesson of manifest.lessons) {
  const parsed = await loadCfmLesson(lesson.sourceKey);
  const references = parsed.inventory.references.map((r) => {
    const target = String(r.target.sourceKey),
      p = parseOtbPassage(target);
    const chapter =
      p &&
      index.chapters.find(
        (c) => c.bookKey === p.bookKey && c.chapter === p.chapter,
      );
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
    const provenExternal = !p && verifiedOfficialUrl(target);
    const reason = !p
      ? provenExternal
        ? null
        : unsupported
      : !chapter
        ? "MISSING_CHAPTER"
        : p.verses?.some((v) => !chapter.verses.includes(v))
          ? "MISSING_VERSE"
          : p.verses && p.verses.length > 40
            ? "EXPLICIT_RANGE_TOO_LARGE"
            : null;
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
    .filter((d) => d.code === "VIDEO_EXTERNAL_REVIEW").length,
  imagesAndPosters: lessons.reduce((n, l) => n + l.media, 0),
  missingSourceAlt: lessons
    .flatMap((l) => l.diagnostics)
    .filter((d) => d.code === "MISSING_SOURCE_ALT").length,
  productionPublished: false,
  sourceIndexIsNotProductionAccessProof: true,
  lessons,
};
await fs.writeFile(
  "data/study-content/cfm-2026-nl/quality-report.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify({ ...report, lessons: undefined }));
