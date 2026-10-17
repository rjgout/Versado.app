import type { AnnotationKind, AnnotationTarget, PassageSelector } from "./contract";

/** Eén bron voor de vijf markeringskleuren (opslagwaarden); client en server gebruiken dezelfde lijst. */
export const ANNOTATION_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];
export type AnnotationView = {
  id: string;
  kind: AnnotationKind;
  targetKey: string;
  target: AnnotationTarget;
  mutationVersion: number;
  deleted: boolean;
  anchorStatus: string;
  text?: string;
  color?: string;
  /**
   * Alleen in de studielezer (fase 4D): de effectieve plaats in de nu gepubliceerde revisie. `target` blijft de
   * oorspronkelijke identiteit voor bewerken en verwijderen; alleen een bewezen EXACT-plaats heeft een selector.
   */
  placement?: { status: "EXACT" | "NEEDS_REVIEW" | "ORPHANED"; selector?: PassageSelector };
};
export type AnnotationList = {
  annotations: AnnotationView[];
  complete: boolean;
};
// Gelijke canonicalisatie als studyObjectHash; geen servermodule in de clientbundle.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function clientTargetKey(
  target: AnnotationTarget,
): Promise<string> {
  if (target.type === "verse") return `verse:${target.verseId}`;
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      canonical({
        lessonEditionId: target.lessonEditionId,
        revisionId: target.revisionId,
        sectionAnchor: target.selector.sectionAnchor,
        ranges: target.selector.ranges,
      }),
    ),
  );
  return `lesson:${Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
