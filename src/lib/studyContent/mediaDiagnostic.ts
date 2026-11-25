import { StudyPublishingError } from "./policy";
export type MediaDiagnostic = {
  stage:
    | "READ"
    | "FILE_SIZE"
    | "FILE_HASH"
    | "MIME"
    | "DECODE"
    | "CHECKSUM"
    | "DOWNLOAD"
    | "MANIFEST"
    | "SNAPSHOT";
  reason?: string;
  year?: number;
  lessonKey?: string;
  mediaId?: string;
  expectedChecksum?: string;
  actualChecksum?: string;
  expectedBytes?: number;
  actualBytes?: number;
  status?: number;
  host?: string;
  pathname?: string;
};
/** Alleen vaste codes/identiteiten: geen headers, tokens, lokale paden of vrije upstreamfouten. */
export class StudyMediaError extends StudyPublishingError {
  constructor(readonly diagnostic: MediaDiagnostic) {
    super("MEDIA");
  }
}
export function mediaContext(
  error: unknown,
  context: Pick<MediaDiagnostic, "year" | "lessonKey">,
): never {
  if (error instanceof StudyMediaError)
    throw new StudyMediaError({ ...error.diagnostic, ...context });
  if (error instanceof StudyPublishingError && error.code === "MEDIA")
    throw new StudyMediaError({ stage: "MANIFEST", ...context });
  throw error;
}
export function mediaDiagnosticText(error: unknown) {
  if (!(error instanceof StudyMediaError)) return null;
  const d = error.diagnostic;
  return [
    `CFM ${d.year ?? "?"}`,
    `les ${d.lessonKey ?? "?"}`,
    d.stage,
    d.reason,
    d.mediaId && `media=${d.mediaId}`,
    d.expectedChecksum && `verwacht=${d.expectedChecksum}`,
    d.actualChecksum && `ontvangen=${d.actualChecksum}`,
    d.expectedBytes !== undefined && `verwachte bytes=${d.expectedBytes}`,
    d.actualBytes !== undefined && `ontvangen bytes=${d.actualBytes}`,
    d.status !== undefined && `HTTP=${d.status}`,
    d.host && d.pathname && `bron=${d.host}${d.pathname}`,
  ]
    .filter(Boolean)
    .join("; ");
}
