import type { PrismaClient } from "../src/generated/prisma/client";
import { bankContentKey, bookKeyOf, type GeneesBankSeed } from "../src/lib/snelleZendeling/reviveBank";

/**
 * Leest een Genees-vragenbank (prisma/genees/) in. Idempotent: een bestaande
 * vraag wordt bijgewerkt op haar contentKey, zodat de geschiedenis van spelers
 * blijft staan. Antwoordopties met dezelfde tekst en uitkomst houden hun id
 * (een lopende run verwijst ernaar). Vragen van deze bank die niet meer in het
 * bestand staan worden verwijderd; "legacy:"-vragen en andere banken blijven.
 */
export async function importGeneesBank(
  prisma: PrismaClient,
  bank: GeneesBankSeed,
  log: (message: string) => void = console.log
): Promise<{ created: number; updated: number; removed: number; skipped: number }> {
  const stats = { created: 0, updated: 0, removed: 0, skipped: 0 };
  const keep = new Set<string>();

  const books = await prisma.book.findMany({
    where: { contentCollectionId: bank.collectionId },
    select: { id: true, key: true },
  });
  const bookIdByKey = new Map(books.filter((book) => book.key).map((book) => [book.key as string, book.id]));

  for (const chapterSeed of bank.chapters) {
    const bookId = bookIdByKey.get(bookKeyOf(bank, chapterSeed));
    const chapter = bookId ? await prisma.chapter.findUnique({ where: { bookId_number: { bookId, number: chapterSeed.chapter } }, select: { id: true } }) : null;
    if (!chapter) {
      stats.skipped += chapterSeed.questions.length;
      continue;
    }
    for (const [index, question] of chapterSeed.questions.entries()) {
      const contentKey = bankContentKey(bank, chapterSeed, question);
      keep.add(contentKey);
      const options = [
        { label: question.correct, isCorrect: true },
        ...question.wrong.map((label) => ({ label, isCorrect: false })),
      ];
      const existing = await prisma.quickMissionaryReviveQuestion.findUnique({
        where: { contentKey },
        select: { id: true, options: { orderBy: { order: "asc" }, select: { id: true, label: true, isCorrect: true } } },
      });
      if (!existing) {
        await prisma.quickMissionaryReviveQuestion.create({
          data: {
            contentKey,
            chapterId: chapter.id,
            variant: index + 1,
            prompt: question.prompt,
            status: "APPROVED",
            options: { create: options.map((option, order) => ({ ...option, order })) },
          },
        });
        stats.created++;
        continue;
      }
      await prisma.quickMissionaryReviveQuestion.update({
        where: { id: existing.id },
        data: { chapterId: chapter.id, variant: index + 1, prompt: question.prompt, status: "APPROVED" },
      });
      const same =
        existing.options.length === options.length &&
        options.every((option) => existing.options.some((old) => old.label === option.label && old.isCorrect === option.isCorrect));
      if (!same) {
        await prisma.quickMissionaryReviveOption.deleteMany({ where: { questionId: existing.id } });
        await prisma.quickMissionaryReviveOption.createMany({ data: options.map((option, order) => ({ ...option, questionId: existing.id, order })) });
      }
      stats.updated++;
    }
  }

  // Vragen van déze bank die uit het bestand verdwenen zijn.
  const stale = await prisma.quickMissionaryReviveQuestion.findMany({
    where: { contentKey: { startsWith: `${bank.id}:`, notIn: [...keep] } },
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.quickMissionaryReviveQuestion.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    stats.removed = stale.length;
  }
  log(`Genees-vragen (${bank.id}): ${stats.created} nieuw, ${stats.updated} bijgewerkt, ${stats.removed} verwijderd${stats.skipped ? `, ${stats.skipped} overgeslagen (hoofdstuk niet gevonden)` : ""}.`);
  return stats;
}
