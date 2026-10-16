import review from "../../../data/study-content/cfm-2026-nl/reference-review.json";
import sourceLock from "../../../data/study-content/cfm-2026-nl/source-lock.json";
import { loadCfmLesson } from "./cfm2026Import";
import { CFM_RIGHTS } from "./cfm2026Adapter";
import { studyObjectHash, StudyPublishingError } from "./policy";
import type { StudyRevisionInput } from "./revisions";

/** Geen nieuwe mapping of goedgekeurde URL: alleen de exact beoordeelde, inactieve labels. */
export async function cfmDisplayOnlyKeys(
  sourceKey: string,
  content: StudyRevisionInput,
  sourceVersion?: string,
) {
  const pin = sourceLock.lessons[sourceKey as keyof typeof sourceLock.lessons];
  if (!pin || (sourceVersion && pin !== sourceVersion))
    throw new StudyPublishingError("INVALID");
  const parsed = await loadCfmLesson(sourceKey);
  if (
    studyObjectHash(parsed.document) !== studyObjectHash(content.body) ||
    parsed.title !== content.title ||
    content.sourceMetadata.url !== parsed.lesson.sourceUrl ||
    studyObjectHash(content.rightsMetadata) !== studyObjectHash(CFM_RIGHTS)
  )
    throw new StudyPublishingError("INVALID");
  const assessments = [
    ...review.assessments,
    ...review.additionalFindings,
  ].filter(
    (r) => r.lesson === sourceKey && r.classification === "C_MANUAL_REVIEW",
  );
  return parsed.inventory.references
    .filter((r) =>
      assessments.some(
        (a) =>
          a.sourceLocation === r.occurrenceKey &&
          a.label === r.label &&
          studyObjectHash(a.currentTarget) === studyObjectHash(r.target),
      ),
    )
    .map((r) => r.occurrenceKey);
}
