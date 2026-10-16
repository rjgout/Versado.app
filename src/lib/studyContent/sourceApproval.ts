import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { StudyPublishingError } from "./policy";

/** Gepinde beheervoorstelling en CLI delen exact dezelfde goedkeuringsidentiteit. */
export async function cfmApprovedSnapshot() {
  const hash = createHash("sha256");
  try {
    for (const name of [
      "source-lock.json",
      "media-lock.json",
      "otb-index.json",
      "reference-source-checks.json",
      "reference-review.json",
    ]) {
      hash
        .update(name)
        .update("\0")
        .update(await fs.readFile(`data/study-content/cfm-2026-nl/${name}`));
    }
    return hash.digest("hex");
  } catch {
    throw new StudyPublishingError("INCOMPLETE");
  }
}
export async function requireCfmApproval(approved: string) {
  if (approved !== (await cfmApprovedSnapshot()))
    throw new StudyPublishingError("CONFLICT");
}
