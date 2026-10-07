// Controleert de gecureerde Genees-vragenbanken tegen de brontekst en toont de
// dekking per boek. Zonder database. Gebruik:
//   npm run genees:check             overzicht per boek
//   npm run genees:check -- --gaps   ook alle hoofdstukken onder het doel
import { GENEES_BANKS } from "../../prisma/genees";
import { TARGET_VARIANTS, coverageOf, validateGeneesBank } from "../../src/lib/snelleZendeling/reviveBank";
import { chaptersOf, verseProviderFor } from "./source";

const showGaps = process.argv.includes("--gaps");
let failed = false;

for (const bank of GENEES_BANKS) {
  const problems = validateGeneesBank(bank, verseProviderFor(bank));
  const chapters = chaptersOf(bank);
  const coverage = coverageOf(bank, chapters);
  const questions = bank.chapters.reduce((sum, chapter) => sum + chapter.questions.length, 0);
  console.log(`\n== ${bank.id} (${bank.collectionId}): ${questions} vragen`);
  console.log(`   hoofdstukken met een vraag: ${coverage.covered}/${coverage.total}; met ${TARGET_VARIANTS} of meer varianten: ${coverage.atTarget}/${coverage.total}`);

  const perBook = new Map<string, { total: number; covered: number; atTarget: number }>();
  const counts = new Map(bank.chapters.map((chapter) => [`${chapter.book}:${chapter.chapter}`, chapter.questions.length]));
  for (const chapter of chapters) {
    const row = perBook.get(chapter.book) ?? { total: 0, covered: 0, atTarget: 0 };
    const n = counts.get(`${chapter.book}:${chapter.chapter}`) ?? 0;
    row.total++;
    if (n > 0) row.covered++;
    if (n >= TARGET_VARIANTS) row.atTarget++;
    perBook.set(chapter.book, row);
  }
  for (const [book, row] of perBook) console.log(`   ${book.padEnd(8)} ${String(row.covered).padStart(2)}/${String(row.total).padEnd(2)} met vraag, ${String(row.atTarget).padStart(2)}/${String(row.total).padEnd(2)} op doel`);
  if (showGaps && coverage.below.length > 0) console.log(`   onder het doel: ${coverage.below.map((chapter) => `${chapter.book} ${chapter.chapter} (${chapter.variants})`).join(", ")}`);

  if (problems.length > 0) {
    failed = true;
    console.log(`\n   ${problems.length} probleem/problemen:`);
    for (const problem of problems) console.log(`   - ${problem.where}: ${problem.message}`);
  }
}
console.log(failed ? "\nGENEES-CONTROLE: PROBLEMEN" : "\nGENEES-CONTROLE: GOED");
process.exit(failed ? 1 : 0);
