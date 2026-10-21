// Herstel van dubbele leescursussen (zie docs/CURSUSIDENTITEIT.md). Een productiegegevenscorrectie: alleen na expliciete goedkeuring.
//   npx tsx scripts/courses/repair-duplicates.ts                          # dry-run (standaard): toont het plan, schrijft niets
//   npx tsx scripts/courses/repair-duplicates.ts --apply --backup-gemaakt --verwacht-database=<host>:<poort>/<database> # voert alleen de groepen met oordeel "merge" uit
// Voorwaarden voor --apply: een verse databaseback-up (scripts/backup.sh) en een gecontroleerd dry-run-plan. Geblokkeerde groepen
// worden nooit aangeraakt. Herhaald draaien is veilig: na een geslaagde run is er niets meer te doen.
import { applyDuplicateRepair, planDuplicateRepair } from "../../src/lib/courseRepair";
import { confirmsDatabaseIdentity, formatDatabaseIdentity, resolveDatabase } from "./target";

const apply = process.argv.includes("--apply");
if (apply && !process.argv.includes("--backup-gemaakt")) {
  console.error("Weigering: --apply vereist --backup-gemaakt (bevestiging dat een verse databaseback-up bestaat).");
  process.exit(2);
}
// De verbinding wordt eenmaal vastgesteld, vóór er een client bestaat, en expliciet aan de client doorgegeven.
const database = resolveDatabase();
const target = database.label;
console.error(`Doeldatabase: ${formatDatabaseIdentity(target)}${apply ? " (WIJZIGT GEGEVENS)" : " (dry-run)"}`);
// Tegen een verkeerde omgeving: --apply werkt alleen als de operator host, poort én databasenaam letterlijk bevestigt (dezelfde naam kan
// op verschillende servers bestaan). Dit gebeurt vóór er een databaseverbinding wordt gemaakt.
const confirmation = process.argv.find((arg) => arg.startsWith("--verwacht-database="))?.slice("--verwacht-database=".length);
if (apply && !confirmsDatabaseIdentity(target, confirmation)) {
  console.error(`Weigering: --apply vereist --verwacht-database=${formatDatabaseIdentity(target)} (host:poort/database van de verbinding waarop dit script nu zou draaien).`);
  process.exit(2);
}
process.env.DATABASE_URL = database.url;
const { createPrismaClient } = await import("../../src/lib/db");
const client = createPrismaClient({ url: database.url });
try {
  const plans = await planDuplicateRepair(client);
  console.log(JSON.stringify(plans, null, 2));
  if (plans.length === 0) console.error("Niets te herstellen.");
  else if (!apply) console.error(`Dry-run: er is niets gewijzigd. Controleer het plan en draai opnieuw met --apply --backup-gemaakt --verwacht-database=${formatDatabaseIdentity(target)}.`);
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
