export type PuzzleErrorCode =
  | "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "CAPACITY" | "NOT_FRIENDS" | "EXPIRED" | "CLOSED"
  | "LOCKED" | "NO_LOCK" | "CONFLICT" | "HINT_EMPTY" | "HINT_CONFIRM" | "ALREADY" | "NOT_STARTED";

/** Fout met een stabiele code; routes vertalen die naar een status en een Nederlandse tekst. */
export class PuzzleServiceError extends Error {
  constructor(readonly code: PuzzleErrorCode, readonly detail: Record<string, unknown> = {}) { super(code); }
}

export function puzzleErrorStatus(code: PuzzleErrorCode): number {
  switch (code) {
    case "NOT_FOUND": return 404;
    case "FORBIDDEN": case "NOT_FRIENDS": return 403;
    case "INVALID": return 400;
    case "HINT_EMPTY": return 402;
    case "NOT_STARTED": case "CLOSED": case "EXPIRED": return 410;
    default: return 409;
  }
}
