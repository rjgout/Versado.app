import { createHash } from "node:crypto";
import { z } from "zod";

/** Een poging houdt dezelfde sleutel bij dubbelklikken/retry; een nieuwe oefenronde krijgt een nieuwe. */
export function activitySubmissionKey(headers: Headers, scope: string, answers: unknown): string {
  const id = z.string().min(21).max(64).regex(/^[A-Za-z0-9_-]+$/).safeParse(headers.get("x-activity-id"));
  // Oudere geopende clients sturen nog geen poging-id. Dezelfde inzending
  // wordt daar conservatief eenmaal verwerkt in plaats van dubbel beloond.
  const key = id.success ? id.data : createHash("sha256").update(JSON.stringify(answers)).digest("hex");
  return `${scope}:${key}`;
}
