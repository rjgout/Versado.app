import type { PrismaClient } from "../src/generated/prisma/client";
import { markAudioCurrent } from "../src/lib/audioCheck";

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

/** Tijdcodes zijn bruikbaar als er één per vers is en ze niet teruglopen; anders horen ze niet bij deze tekst. */
export function audioEntryIsValid(entry: ChapterAudioSeed, verseCount: number): boolean {
  if (entry.verseStarts.length !== verseCount) return false;
  for (let i = 1; i < entry.verseStarts.length; i++) if (!(entry.verseStarts[i] >= entry.verseStarts[i - 1])) return false;
  return entry.verseStarts.every((start) => Number.isFinite(start) && start >= 0);
}

/**
 * Zet de audio op de hoofdstukken en verzen. Idempotent, en nooit destructief: alleen gevalideerde audiogegevens (één geldige begintijd
 * per vers) worden toegepast, en wat er al staat wordt nooit weggehaald, ook niet als een hoofdstuk niet (meer) in de lijst staat of de
 * gegevens niet bij de tekst passen. Zulke hoofdstukken blijven afspeelbaar en worden ter controle aangemerkt (ChapterAudioCheck).
 * Alleen nieuwe, gevalideerde gegevens voor een hoofdstuk zetten het weer op "passend" (CURRENT). Draait na importBooks, want die
 * maakt de verzen aan.
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
      audioCheck: { select: { status: true } },
      book: { select: { slug: true, key: true } },
      verses: { select: { id: true, number: true, audioStart: true } },
    },
  });

  const verseUpdates: { id: string; audioStart: number | null }[] = [];
  let chapterUpdates = 0;
  let withAudio = 0;
  let skipped = 0;
  let resolved = 0;
  for (const chapter of chapters) {
    // Nederlandse audiometadata gebruikt historisch de slug; nieuwe uitgaven
    // gebruiken de taaloverschrijdende Book.key. Zo blijft het bestaande
    // bestand ongewijzigd terwijl andere talen veilig gekoppeld worden.
    const entry =
      (chapter.book.key ? byKey.get(`${chapter.book.key}:${chapter.number}`) : undefined) ??
      byKey.get(`${chapter.book.slug}:${chapter.number}`);
    const usable = entry && audioEntryIsValid(entry, chapter.verses.length) ? entry : null;
    if (entry && !usable) skipped += 1;
    // Bestaande audio blijft staan als er geen (geldige) nieuwe gegevens voor zijn.
    if (!usable) {
      if (chapter.audioUrl) withAudio += 1;
      if (entry && chapter.audioUrl && chapter.audioCheck?.status !== "NEEDS_REVIEW") {
        await prisma.chapterAudioCheck.upsert({
          where: { chapterId: chapter.id },
          create: { chapterId: chapter.id, status: "NEEDS_REVIEW", textHash: "onbekend", flaggedAt: new Date(), detail: { reason: "AUDIO_DATA_INVALID", changedVerses: [], verseCountBefore: chapter.verses.length, verseCountAfter: entry.verseStarts.length } },
          update: { status: "NEEDS_REVIEW", flaggedAt: new Date(), detail: { reason: "AUDIO_DATA_INVALID", changedVerses: [], verseCountBefore: chapter.verses.length, verseCountAfter: entry.verseStarts.length } },
        });
      }
      continue;
    }
    withAudio += 1;

    const data = { audioUrl: usable.url, audioHeadingStart: usable.headingStart, audioHeadingEnd: usable.headingEnd };
    let changed = false;
    if (
      chapter.audioUrl !== data.audioUrl ||
      chapter.audioHeadingStart !== data.audioHeadingStart ||
      chapter.audioHeadingEnd !== data.audioHeadingEnd
    ) {
      await prisma.chapter.update({ where: { id: chapter.id }, data });
      chapterUpdates += 1;
      changed = true;
    }
    for (const verse of chapter.verses) {
      const start = usable.verseStarts[verse.number - 1] ?? null;
      if (verse.audioStart !== start) {
        verseUpdates.push({ id: verse.id, audioStart: start });
        changed = true;
      }
    }
    // Zonder registratie: de gevalideerde gegevens gelden als passend bij de huidige tekst. Mét een openstaande controle zijn alleen
    // gewijzigde audiogegevens bewijs dat er nieuwe audio voor de nieuwe tekst is; ongewijzigde gegevens lossen niets op.
    const status = chapter.audioCheck?.status;
    // (De hash hangt alleen van de verstekst af, niet van de tijdcodes; die worden hieronder in blokken weggeschreven.)
    if (!chapter.audioCheck || (status === "NEEDS_REVIEW" && changed)) {
      await markAudioCurrent(prisma, chapter.id);
      if (status === "NEEDS_REVIEW") resolved += 1;
    }
  }

  for (let i = 0; i < verseUpdates.length; i += CHUNK) {
    const chunk = verseUpdates.slice(i, i + CHUNK);
    await prisma.$transaction(chunk.map((v) => prisma.verse.update({ where: { id: v.id }, data: { audioStart: v.audioStart } })));
  }
  log(
    `  Audio: ${withAudio} hoofdstukken met audio, ${chapterUpdates} hoofdstukken en ${verseUpdates.length} verzen bijgewerkt` +
      (skipped ? `, ${skipped} niet toegepast (tijdcodes kloppen niet met de tekst; bestaande audio blijft staan, ter controle aangemerkt)` : "") +
      (resolved ? `, ${resolved} controle(s) afgehandeld door nieuwe gevalideerde audiogegevens` : "") +
      "."
  );
}
