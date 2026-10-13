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
  // Nog geen goedgekeurde officiële bronadapter/fixture. Fase 2D bewijst interne editiemappings.
  return adapter === "synthetic-v1" && syntheticStudyEnvironment();
}
