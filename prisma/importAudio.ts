import type { PrismaClient } from "../src/generated/prisma/client";

// Voorgelezen hoofdstukken: per hoofdstuk het audiobestand van de kerk in de
// taal van de uitgave, met de begintijd van elk vers en van de hoofdstukkop.
// De tijden zijn eenmalig berekend met
// spraakherkenning op de audio, uitgelijnd op de bekende tekst en afgerond
// op het einde van de pauze vóór elk vers (zodat een vers nooit midden in een
// woord begint). audioUrl blijft de bron-URL van de kerk; de eigen kopie en
// welke link de speler krijgt regelt src/lib/audioMirror.ts.

export interface ChapterAudioSeed {
  /** Book.key voor taaloverschrijdende data; oude Nederlandse data gebruikt Book.slug. */
  book: string;
  chapter: number;
  url: string;
  headingStart: number;
  headingEnd: number;
  verseStarts: number[];
}

const CHUNK = 500;

/**
 * Zet de audio op de hoofdstukken en verzen. Idempotent: schrijft alleen wat
 * verschilt. Een onvolledige import verwijdert nooit bestaande audio. Draait na importBooks, want die maakt de verzen aan.
 */
export async function importChapterAudio(
  prisma: PrismaClient,
  entries: ChapterAudioSeed[],
  contentCollectionId: string,
  log: (msg: string) => void = console.log
) {
  const byKey = new Map(entries.map((e) => [`${e.book}:${e.chapter}`, e]));
  const chapters = await prisma.chapter.findMany({
    where: { book: { contentCollectionId } },
    select: {
      id: true,
      number: true,
      audioUrl: true,
      audioHeadingStart: true,
      audioHeadingEnd: true,
      book: { select: { slug: true, key: true } },
      verses: { select: { id: true, number: true, audioStart: true } },
    },
  });

  const verseUpdates: { id: string; audioStart: number | null }[] = [];
  let chapterUpdates = 0;
  let withAudio = 0;
  let skipped = 0;
  for (const chapter of chapters) {
    // Nederlandse audiometadata gebruikt historisch de slug; nieuwe uitgaven
    // gebruiken de taaloverschrijdende Book.key. Zo blijft het bestaande
    // bestand ongewijzigd terwijl andere talen veilig gekoppeld worden.
    const entry =
      (chapter.book.key ? byKey.get(`${chapter.book.key}:${chapter.number}`) : undefined) ??
      byKey.get(`${chapter.book.slug}:${chapter.number}`);
    // Een telling die niet klopt met de verzen in de database hoort bij een
    // andere tekst: dan liever geen audio dan verzen die verspringen.
    const usable = entry && entry.verseStarts.length === chapter.verses.length
      && [entry.headingStart, entry.headingEnd, ...entry.verseStarts].every((t) => Number.isFinite(t) && t >= 0)
      && entry.headingEnd >= entry.headingStart
      && entry.verseStarts.every((t, i) => i === 0 || t >= entry.verseStarts[i - 1]) ? entry : null;
    if (entry && !usable) skipped += 1;
    if (!usable) continue;
    withAudio += 1;

    const data = {
      audioUrl: usable?.url ?? null,
      audioHeadingStart: usable?.headingStart ?? null,
      audioHeadingEnd: usable?.headingEnd ?? null,
    };
    if (
      chapter.audioUrl !== data.audioUrl ||
      chapter.audioHeadingStart !== data.audioHeadingStart ||
      chapter.audioHeadingEnd !== data.audioHeadingEnd
    ) {
      await prisma.chapter.update({ where: { id: chapter.id }, data });
      chapterUpdates += 1;
    }
    for (const verse of chapter.verses) {
      const start = usable?.verseStarts[verse.number - 1] ?? null;
      if (verse.audioStart !== start) verseUpdates.push({ id: verse.id, audioStart: start });
    }
  }

  for (let i = 0; i < verseUpdates.length; i += CHUNK) {
    const chunk = verseUpdates.slice(i, i + CHUNK);
    await prisma.$transaction(chunk.map((v) => prisma.verse.update({ where: { id: v.id }, data: { audioStart: v.audioStart } })));
  }
  log(
    `  Audio: ${withAudio} hoofdstukken met audio, ${chapterUpdates} hoofdstukken en ${verseUpdates.length} verzen bijgewerkt` +
      (skipped ? `, ${skipped} overgeslagen (aantal verzen klopt niet)` : "") +
      "."
  );
}
