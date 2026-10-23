import type { PrismaClient } from "@/generated/prisma/client";
import type { SeedBook } from "../../../prisma/content";
import dcDe from "../../../prisma/dcContent.de.json";
import dcFr from "../../../prisma/dcContent.fr.json";
import dcEs from "../../../prisma/dcContent.es.json";
import pgpDe from "../../../prisma/pgpContent.de.json";
import pgpFr from "../../../prisma/pgpContent.fr.json";
import pgpEs from "../../../prisma/pgpContent.es.json";
const editions = [
  ["dc", "dc-testament", "de", "Lehre und Bündnisse", dcDe], ["dc", "dc-testament", "fr", "Doctrine et Alliances", dcFr], ["dc", "dc-testament", "es", "Doctrina y Convenios", dcEs],
  ["pgp", "pgp", "de", "Die Köstliche Perle", pgpDe], ["pgp", "pgp", "fr", "La Perle de Grand Prix", pgpFr], ["pgp", "pgp", "es", "La Perla de Gran Precio", pgpEs],
] as const;
/** Uitsluitend de expliciet goedgekeurde ontbrekende uitgaven, atomair per uitgave.
 * Bestaande uitgaven worden nooit overschreven. Geen oefeningen/cursussen/inschrijvingen. */
export async function ensureHiddenAudioTextEditions(db: PrismaClient) {
  for (const [prefix, work, language, name, books] of editions) {
    const id = `content_${prefix}_${language}`;
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))::text`;
      if (await tx.contentCollection.findFirst({ where: { OR: [{ id }, { work, language, editionKey: work }] } })) return;
      await tx.contentCollection.create({ data: { id, slug: `${prefix}-${language}`, name, work, language, editionKey: work, icon: "book", enabled: false, visibleToUsers: false, publicationState: "DRAFT", sourceName: "The Church of Jesus Christ of Latter-day Saints", sourceUrl: `https://www.churchofjesuschrist.org/study/scriptures/${work}` } });
      for (const [order, seed] of (books as unknown as SeedBook[]).entries()) {
        const book = await tx.book.create({ data: { contentCollectionId: id, slug: seed.slug, key: seed.key, name: seed.name, order } });
        for (const [chapterOrder, chapter] of seed.chapters.entries()) {
          await tx.chapter.create({ data: { bookId: book.id, number: chapter.number, order: chapterOrder, heading: chapter.heading, verses: { create: chapter.verses.map((text, i) => ({ number: i + 1, text })) } } });
        }
      }
    }, { timeout: 120000 });
  }
}
