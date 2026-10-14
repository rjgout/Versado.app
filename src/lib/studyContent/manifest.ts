export type ManifestStatus = "VALID" | "WARNING" | "BLOCKED";

export interface StudyManifestLesson {
  sourceKey: string;
  periodSourceKey: string;
  title: string;
  language: string;
  year: number;
  sourceUrl: string;
  startsOn: string;
  endsOn: string;
  order: number;
  scriptureReferences: string[];
  fullContent: "AVAILABLE" | "UNAVAILABLE";
  media: { observedCount: number; inventoryStatus: ManifestStatus };
  sourceStatus: ManifestStatus;
  referenceStatus: ManifestStatus;
}

export interface StudyManifest {
  id: string;
  workKey: string;
  editionKey: string;
  language: string;
  year: number;
  canonicalUrl: string;
  verifiedAt: string;
  rightsStatus: ManifestStatus;
  lessons: readonly StudyManifestLesson[];
}

export interface ManifestDiagnostic {
  status: ManifestStatus;
  code: string;
  lesson?: string;
  detail: string;
}

const officialHost = "www.churchofjesuschrist.org";
const date = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string) => date.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const asDay = (value: string) => Date.parse(`${value}T00:00:00Z`);
const oneDay = 86_400_000;

/** Valideert alleen de vastgelegde bronmetadata; deze functie doet geen netwerkverkeer. */
export function validateStudyManifest(manifest: StudyManifest): ManifestDiagnostic[] {
  const diagnostics: ManifestDiagnostic[] = [];
  const sourceKeys = new Set<string>();
  const periodKeys = new Set<string>();
  let previous: StudyManifestLesson | null = null;

  for (const lesson of manifest.lessons) {
    const add = (status: ManifestStatus, code: string, detail: string) =>
      diagnostics.push({ status, code, lesson: lesson.sourceKey, detail });
    if (sourceKeys.has(lesson.sourceKey)) add("BLOCKED", "DUPLICATE_SOURCE_KEY", "sourceKey is niet uniek.");
    sourceKeys.add(lesson.sourceKey);
    if (periodKeys.has(lesson.periodSourceKey)) add("BLOCKED", "DUPLICATE_PERIOD_KEY", "periodSourceKey is niet uniek.");
    periodKeys.add(lesson.periodSourceKey);
    if (!lesson.title.trim() || !lesson.sourceUrl || !lesson.scriptureReferences.length)
      add("BLOCKED", "MISSING_REQUIRED_METADATA", "Verplichte bronmetadata ontbreekt.");
    if (lesson.language !== manifest.language || !/^[a-z]{2,3}$/.test(lesson.language))
      add("BLOCKED", "INVALID_LANGUAGE", "De contenttaal is onbekend of wijkt af van het manifest.");
    try {
      const url = new URL(lesson.sourceUrl);
      if (url.protocol !== "https:" || url.hostname !== officialHost)
        add("BLOCKED", "UNOFFICIAL_SOURCE_URL", "De bron-URL is niet de officiële bron.");
    } catch { add("BLOCKED", "INVALID_SOURCE_URL", "De bron-URL is ongeldig."); }
    if (!validDate(lesson.startsOn) || !validDate(lesson.endsOn) || asDay(lesson.endsOn) < asDay(lesson.startsOn))
      add("BLOCKED", "INVALID_CALENDAR_INTERVAL", "Het kalenderinterval is ongeldig.");
    if (lesson.order < 1 || lesson.order > manifest.lessons.length)
      add("BLOCKED", "INVALID_ORDER", "De officiële volgorde is ongeldig.");
    if (previous) {
      if (lesson.order !== previous.order + 1)
        add("BLOCKED", "ORDER_GAP", "De officiële lesvolgorde bevat een gat.");
      const expected = asDay(previous.endsOn) + oneDay;
      if (asDay(lesson.startsOn) < expected)
        add("WARNING", "CALENDAR_OVERLAP", "Overlappende perioden vereisen bronbewijs.");
      if (asDay(lesson.startsOn) > expected)
        add("WARNING", "CALENDAR_GAP", "Een kalendergat vereist bronbewijs.");
    }
    if (lesson.media.inventoryStatus !== "VALID")
      add("WARNING", "MEDIA_INVENTORY_INCOMPLETE", "Media zijn wel waargenomen maar nog niet semantisch of rechtenmatig vrijgegeven.");
    if (lesson.referenceStatus !== "VALID")
      add(lesson.referenceStatus, "REFERENCE_MAPPING_INCOMPLETE", "Geen bewezen interne editie-equivalentie voor alle verwijzingen.");
    previous = lesson;
  }
  if (!manifest.lessons.length) diagnostics.push({ status: "BLOCKED", code: "NO_LESSONS", detail: "Het manifest bevat geen lessen." });
  if (manifest.rightsStatus !== "VALID") diagnostics.push({ status: manifest.rightsStatus, code: "RIGHTS_NOT_CLEARED", detail: "Opslag en publicatie wachten op een expliciete rechtenbeslissing." });
  return diagnostics;
}

export function manifestStatus(diagnostics: readonly ManifestDiagnostic[]): ManifestStatus {
  if (diagnostics.some((diagnostic) => diagnostic.status === "BLOCKED")) return "BLOCKED";
  if (diagnostics.some((diagnostic) => diagnostic.status === "WARNING")) return "WARNING";
  return "VALID";
}
