// Backfill van persoonlijke beste tijden uit historische puzzelgegevens (fase 4).
//   npx tsx scripts/puzzle/backfill-best-records.ts            # dry-run (standaard): alleen aantallen
//   npx tsx scripts/puzzle/backfill-best-records.ts --apply    # schrijft records (idempotent en herhaalbaar)
// Raakt geen reeksen, hinttegoeden, notificaties of wedstrijdresultaten en verwijdert niets.
import { createPrismaClient } from "../../src/lib/db";
import { backfillBestRecords } from "../../src/lib/puzzle/recordsBackfill";

const apply = process.argv.includes("--apply");
const client = createPrismaClient();
try {
  const report = await backfillBestRecords(client, { dryRun: !apply });
  console.log(JSON.stringify(report, null, 2));
  if (!apply) console.error("Dry-run: er is niets geschreven. Gebruik --apply voor de echte backfill (na controle van deze aantallen).");
} finally {
  await client.$disconnect();
}
