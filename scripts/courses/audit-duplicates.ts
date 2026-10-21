// Alleen-lezen diagnose van dubbele leescursussen (zie docs/CURSUSIDENTITEIT.md).
//   npx tsx scripts/courses/audit-duplicates.ts
// Schrijft niets. Toont per schriftcollectie en type de cursusrecords en per record de afhankelijkheden (hoofdstukken, lessen,
// abonnementen, voortgang, actieve cursus, lesvoortgang, oefensessies, Samen studeren, persoonlijke volgorde, feedback) plus het
// oordeel van het herstelplan ("merge" of "blocked"). Exitcode 1 zodra er dubbele cursussen zijn (bruikbaar als controle).
import { planDuplicateRepair } from "../../src/lib/courseRepair";
import { formatDatabaseIdentity, resolveDatabase } from "./target";

// De verbinding wordt eenmaal vastgesteld en expliciet aan de client doorgegeven; src/lib/db wordt pas daarna geladen.
const database = resolveDatabase();
const target = database.label;
console.error(`Doeldatabase (alleen lezen, via ${database.source}): ${formatDatabaseIdentity(target)}`);
process.env.DATABASE_URL = database.url;
const { createPrismaClient } = await import("../../src/lib/db");

const client = createPrismaClient({ url: database.url });
try {
  const all = await client.course.findMany({
    where: { type: { in: ["READING_LESSONS", "FRONT_TO_BACK", "FREE_CHOICE"] } },
    select: { id: true, slug: true, type: true, name: true, enabled: true, order: true, contentCollectionId: true },
    orderBy: [{ contentCollectionId: "asc" }, { type: "asc" }, { order: "asc" }],
  });
  const collections = await client.contentCollection.findMany({ select: { id: true, slug: true, order: true, enabled: true, language: true }, orderBy: [{ order: "asc" }, { id: "asc" }] });
  const plans = await planDuplicateRepair(client);
  console.log(JSON.stringify({ target, maintenanceBuild: process.env.NEXT_PUBLIC_BUILD_SHA ?? "onbekend", collections, readingCourses: all, duplicateGroups: plans }, null, 2));
  if (plans.length > 0) {
    console.error(`${plans.length} groep(en) met dubbele leescursussen. Herstel: npx tsx scripts/courses/repair-duplicates.ts (dry-run), daarna --apply na goedkeuring.`);
    process.exitCode = 1;
  } else console.error("Geen dubbele leescursussen.");
} finally {
  await client.$disconnect();
}
