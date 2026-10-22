import { loadCfmLesson } from "./cfm2026Import";
import { CFM_RIGHTS } from "./cfm2026Adapter";
import { CFM_SOURCE_2026, type CfmVolumeSource } from "./cfmSources";
import { isKnownUnresolvableCfmReference, type CfmReferenceTargetShape } from "./cfmReferencePolicy";
import { studyObjectHash, StudyPublishingError } from "./policy";
import type { StudyRevisionInput } from "./revisions";

/**
 * De verwijzingen die als veilige, niet-klikbare tekst gepubliceerd mogen worden wanneer de centrale resolver ze niet kan
 * oplossen. Geen nieuwe mapping en geen goedgekeurde URL: alleen (a) de exact beoordeelde labels van de jaargang en (b) elke
 * andere goed gevormde, veilige officiële verwijzing die als bekend onoplosbaar geldt (cfmReferencePolicy.ts). Onveilige
 * URL's en onherkenbare doelen komen er nooit in en blokkeren de publicatie dus.
 */
async function referenceKeys(
  sourceKey: string,
  content: StudyRevisionInput,
  sourceVersion: string | undefined,
  volume: CfmVolumeSource,
) {
  const pin = volume.sourceLock.lessons[sourceKey];
  if (!pin || (sourceVersion && pin !== sourceVersion))
    throw new StudyPublishingError("INVALID");
  const parsed = await loadCfmLesson(sourceKey, volume);
  if (
    studyObjectHash(parsed.document) !== studyObjectHash(content.body) ||
    parsed.title !== content.title ||
    content.sourceMetadata.url !== parsed.lesson.sourceUrl ||
    studyObjectHash(content.rightsMetadata) !== studyObjectHash(CFM_RIGHTS)
  )
    throw new StudyPublishingError("INVALID");
  const review = volume.referenceReview;
  const assessments = review
    ? [...review.assessments, ...review.additionalFindings].filter((r) => r.lesson === sourceKey && r.classification === "C_MANUAL_REVIEW")
    : [];
  const reviewed = (r: (typeof parsed.inventory.references)[number]) =>
    assessments.some(
      (a) =>
        a.sourceLocation === r.occurrenceKey &&
        a.label === r.label &&
        studyObjectHash(a.currentTarget) === studyObjectHash(r.target),
    );
  return {
    reviewed: parsed.inventory.references.filter(reviewed).map((r) => r.occurrenceKey),
    permitted: parsed.inventory.references
      .filter((r) => reviewed(r) || isKnownUnresolvableCfmReference(r.target as unknown as CfmReferenceTargetShape))
      .map((r) => r.occurrenceKey),
  };
}

/** Alle verwijzingen die als veilige tekst gepubliceerd mogen worden zodra de centrale resolver ze niet oplost. */
export async function cfmDisplayOnlyKeys(
  sourceKey: string,
  content: StudyRevisionInput,
  sourceVersion?: string,
  volume: CfmVolumeSource = CFM_SOURCE_2026,
) {
  return (await referenceKeys(sourceKey, content, sourceVersion, volume)).permitted;
}
/** Alleen de eerder uitdrukkelijk beoordeelde verwijzingen (voor CFM 2026: de 553 gecontroleerde gevallen). */
export async function cfmReviewedDisplayOnlyKeys(
  sourceKey: string,
  content: StudyRevisionInput,
  sourceVersion?: string,
  volume: CfmVolumeSource = CFM_SOURCE_2026,
) {
  return (await referenceKeys(sourceKey, content, sourceVersion, volume)).reviewed;
}
