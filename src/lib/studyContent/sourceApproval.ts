import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { StudyPublishingError } from "./policy";
import { CFM_SOURCES } from "./cfmSources";

/**
 * Gepinde beheervoorstelling en CLI delen exact dezelfde goedkeuringsidentiteit. Ze dekt alle geregistreerde CFM-jaargangen:
 * een nieuwe jaargang of een gewijzigd bronbestand geeft een andere snapshot en vraagt dus opnieuw expliciete goedkeuring.
 * De eerste jaargang hasht zijn bestandsnamen zoals voorheen, zodat de snapshot van een ongewijzigde CFM 2026 gelijk blijft.
 */
export async function cfmApprovedSnapshot() {
  const hash = createHash("sha256");
  try {
    for (const [index, source] of CFM_SOURCES.entries()) {
      for (const name of source.approvalFiles) {
        hash
          .update(index === 0 ? name : `${source.dataDir}/${name}`)
          .update("\0")
          .update(await fs.readFile(`${source.dataDir}/${name}`));
      }
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
