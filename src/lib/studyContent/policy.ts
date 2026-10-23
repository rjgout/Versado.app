import { isCfmAdapter } from "./cfmSources";
import { createHash } from "node:crypto";
import { canonicalJson } from "./revisions";

export class StudyPublishingError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "INVALID"
      | "UNAVAILABLE"
      | "BUSY"
      | "LEASE_LOST"
      | "INCOMPLETE"
      | "REFERENCES"
      | "MEDIA"
      | "STORAGE"
      | "CONFLICT"
      | "RELEASE_CLOSED",
  ) {
    super(code);
  }
}
export type StudyAdmin = { id: string; isAdmin: boolean };
export function requireStudyAdmin(actor: StudyAdmin) {
  if (!actor.isAdmin) throw new StudyPublishingError("FORBIDDEN");
}
export function studyObjectHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
/** Geen algemene boolean om synthetische lessen naar productie te publiceren. */
export function syntheticStudyEnvironment() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      process.env.STUDY_PUBLICATION_PROFILE === "synthetic-test" &&
      url.hostname === "127.0.0.1" &&
      url.pathname === "/versado_content_access_test"
    );
  } catch {
    return false;
  }
}
export function studyReleaseAllowed(adapter: string) {
  // Eén gecontroleerde officiële adapter; zijn inhoud/media/referenties worden opnieuw getoetst.
  // Alleen een geregistreerde, gepinde officiële CFM-bron (cfmSources.ts): geen naamherkenning op een vrij adapterlabel.
  return isCfmAdapter(adapter) || adapter === "fsy-legacy-v1" || (adapter === "synthetic-v1" && syntheticStudyEnvironment());
}
/** Conceptimport is geen publicatie. Onbekende adapters blijven gesloten. */
export function studyImportAllowed(adapter: string) {
  return isCfmAdapter(adapter) || studyReleaseAllowed(adapter);
}
