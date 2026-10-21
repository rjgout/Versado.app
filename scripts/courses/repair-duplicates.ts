// Herstel van dubbele leescursussen (zie docs/CURSUSIDENTITEIT.md). Een productiegegevenscorrectie: alleen na expliciete goedkeuring.
//   npx tsx scripts/courses/repair-duplicates.ts                          # dry-run (standaard): toont het plan, schrijft niets
//   npx tsx scripts/courses/repair-duplicates.ts --apply --backup-gemaakt # voert alleen de groepen met oordeel "merge" uit
// Voorwaarden voor --apply: een verse databaseback-up (scripts/backup.sh) en een gecontroleerd dry-run-plan. Geblokkeerde groepen
// worden nooit aangeraakt. Herhaald draaien is veilig: na een geslaagde run is er niets meer te doen.
import { createPrismaClient } from "../../src/lib/db";
import { applyDuplicateRepair, planDuplicateRepair } from "../../src/lib/courseRepair";

const apply = process.argv.includes("--apply");
if (apply && !process.argv.includes("--backup-gemaakt")) {
  console.error("Weigering: --apply vereist --backup-gemaakt (bevestiging dat een verse databaseback-up bestaat).");
  process.exit(2);
}
const client = createPrismaClient();
try {
  const plans = await planDuplicateRepair(client);
  console.log(JSON.stringify(plans, null, 2));
  if (plans.length === 0) console.error("Niets te herstellen.");
  else if (!apply) console.error("Dry-run: er is niets gewijzigd. Controleer het plan en draai opnieuw met --apply --backup-gemaakt.");
  else {
    const result = await applyDuplicateRepair(client, plans);
    console.log(JSON.stringify(result, null, 2));
    if (result.blocked.length > 0) {
      console.error(`${result.blocked.length} groep(en) geblokkeerd voor handmatige beoordeling en niet aangeraakt.`);
      process.exitCode = 3;
    }
  }
} finally {
  await client.$disconnect();
}
