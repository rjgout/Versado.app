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

/** Tijdcodes zijn bruikbaar als er één per vers is en ze niet teruglopen; anders horen ze niet bij deze tekst. */
export function audioEntryIsValid(entry: ChapterAudioSeed, verseCount: number): boolean {
  if (entry.verseStarts.length !== verseCount) return false;
  if (![entry.headingStart, entry.headingEnd].every((time) => Number.isFinite(time) && time >= 0) || entry.headingEnd < entry.headingStart) return false;
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

  let verseUpdates = 0;
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
    const chapterChanged = chapter.audioUrl !== data.audioUrl || chapter.audioHeadingStart !== data.audioHeadingStart || chapter.audioHeadingEnd !== data.audioHeadingEnd;
    const changedVerses = chapter.verses.flatMap((verse) => {
      const audioStart = usable.verseStarts[verse.number - 1] ?? null;
      return verse.audioStart !== audioStart ? [{ id: verse.id, audioStart }] : [];
    });
    const status = chapter.audioCheck?.status;
    const resolveCheck = !chapter.audioCheck || (status === "NEEDS_REVIEW" && (chapterChanged || changedVerses.length > 0));
    if (!chapterChanged && changedVerses.length === 0 && !resolveCheck) continue;
    // Audio, tijdcodes en controle delen één commitgrens: bij een schrijffout blijft de openstaande controle behouden.
    // Ongewijzigde tijdcodes zijn geen bewijs dat audio bij een gewijzigde tekst past.
    await prisma.$transaction(async (tx) => {
      if (chapterChanged) await tx.chapter.update({ where: { id: chapter.id }, data });
      for (const verse of changedVerses) await tx.verse.update({ where: { id: verse.id }, data: { audioStart: verse.audioStart } });
      if (resolveCheck) await markAudioCurrent(tx, chapter.id);
    });
    if (chapterChanged) chapterUpdates += 1;
    verseUpdates += changedVerses.length;
    if (resolveCheck && status === "NEEDS_REVIEW") resolved += 1;
  }

  log(
    `  Audio: ${withAudio} hoofdstukken met audio, ${chapterUpdates} hoofdstukken en ${verseUpdates} verzen bijgewerkt` +
      (skipped ? `, ${skipped} niet toegepast (tijdcodes kloppen niet met de tekst; bestaande audio blijft staan, ter controle aangemerkt)` : "") +
      (resolved ? `, ${resolved} controle(s) afgehandeld door nieuwe gevalideerde audiogegevens` : "") +
      "."
  );
}
