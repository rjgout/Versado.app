/* Synthetische leesinhoud (eigen tekst, geen schrifttekst) voor de lezer-spike — uitsluitend voor een geïsoleerde test-database.
 * Gebruikt de echte importer (importBooks → syncCourses), dus de gewone cursussen en native leesroutes leveren het hoofdstuk.
 * Draaien vanuit de repo-root: DATABASE_URL=... npx tsx apps/mobile-poc/scripts/seed-reader-content.ts */
import { readFileSync } from "fs";
import { join } from "path";
import { createPrismaClient } from "../../../src/lib/db";
import { importBooks } from "../../../prisma/importContent";
import type { SeedBook } from "../../../prisma/content";

const url = process.env.DATABASE_URL ?? "";
if (!/(127\.0\.0\.1|localhost|postgres)(:\d+)?\/[a-z_]*(test|poc)[a-z_]*/i.test(url) && process.env.POC_ALLOW_SEED !== "1") {
  console.error("Weigert te seeden: DATABASE_URL lijkt geen geïsoleerde test-/poc-database (zet POC_ALLOW_SEED=1 om te forceren).");
  process.exit(1);
}
(async () => {
  const prisma = createPrismaClient();
  const books = JSON.parse(readFileSync(join(__dirname, "../fixtures/proefboek.json"), "utf-8")) as SeedBook[];
  await importBooks(prisma, books, () => {});
  const verses = await prisma.verse.count({ where: { chapter: { book: { slug: "proefboek" } } } });
  console.log(`synthetisch proefhoofdstuk: ${verses} verzen`);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
