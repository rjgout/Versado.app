// CLI om je eigen content te laden zodra je de rechten geregeld hebt.
//
// Gebruik:
//   npm run db:import -- ./mijn-boek-van-mormon.json
//
// Het JSON-bestand moet een array van boeken zijn met dit formaat:
// [
//   {
//     "slug": "1-nephi",
//     "name": "1 Nephi",
//     "chapters": [
//       { "number": 1, "verses": ["Vers 1 tekst...", "Vers 2 tekst...", ...] }
//     ]
//   }
// ]
import { readFileSync } from "fs";
import { withContentImportLock } from "../src/lib/contentImportLock";
import { createPrismaClient } from "../src/lib/db";
import { importBooks } from "./importContent";
import type { SeedBook } from "./content";

const prisma = createPrismaClient();

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Gebruik: npm run db:import -- ./pad/naar/bestand.json");
    process.exit(1);
  }

  const raw = readFileSync(filePath, "utf-8");
  const books = JSON.parse(raw) as SeedBook[];
  console.log(`Importeren van ${books.length} boek(en) uit ${filePath}...`);
  await withContentImportLock(() => importBooks(prisma, books));
  console.log("Import klaar.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
