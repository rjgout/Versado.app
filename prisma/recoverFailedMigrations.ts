import { execFileSync } from "node:child_process";
import { createPrismaClient } from "../src/lib/db";

// Draait in de container vóór `prisma migrate deploy`. Een mislukte migratie
// blokkeert daarna elke deploy (P3009), ook als de migratie inmiddels is
// gerepareerd. Hier staan alleen pogingen waarvan vaststaat dat ze mislukten
// vóórdat er iets in de database veranderde; die mogen veilig als
// teruggedraaid gemarkeerd worden, zodat de gerepareerde versie gewoon draait.
// De checksum is die van de kapotte versie: een andere mislukte poging (ook
// van dezelfde migratie) blijft bewust staan en vraagt om handwerk.
const SAFE_TO_RETRY: { name: string; checksum: string; reason: string }[] = [
  {
    name: "20261015120000_recipient_activity_reaction_batches",
    checksum: "2d64c0274b4121796863da2f5784f96c0db42f8dbd7358f8f91fbffffd4d78a5",
    // De tijdelijke tabel (ON COMMIT DROP) was al weg bij de eerste UPDATE;
    // daarvóór wijzigde de migratie niets.
    reason: "tijdelijke tabel verdween vóór de eerste wijziging",
  },
];

async function main() {
  const db = createPrismaClient();
  try {
    // Op een lege database bestaat de tabel nog niet; dan valt er niets te herstellen.
    const [{ exists }] = await db.$queryRaw<{ exists: boolean }[]>`SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS "exists"`;
    if (!exists) return;
    const failed = await db.$queryRaw<{ migration_name: string; checksum: string }[]>`
      SELECT migration_name, checksum FROM "_prisma_migrations"
      WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    for (const row of failed) {
      const known = SAFE_TO_RETRY.find((m) => m.name === row.migration_name && m.checksum === row.checksum);
      if (!known) {
        console.log(`Mislukte migratie ${row.migration_name} is niet bekend als veilig herhaalbaar; niets aangepast.`);
        continue;
      }
      console.log(`Mislukte migratie ${known.name} (${known.reason}) wordt als teruggedraaid gemarkeerd en opnieuw uitgevoerd.`);
      execFileSync("npx", ["prisma", "migrate", "resolve", "--rolled-back", known.name], { stdio: "inherit" });
    }
  } catch (e) {
    // Database nog niet bereikbaar of nog geen migratietabel: migrate deploy
    // hierna meldt of herstelt dat zelf.
    console.log(`Herstelcontrole overgeslagen: ${e instanceof Error ? e.message.split("\n").at(-1) : e}`);
  } finally {
    await db.$disconnect().catch(() => {});
  }
}

main();
