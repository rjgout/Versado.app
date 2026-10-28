import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

// Registratie van audio-afhankelijkheden (model ChapterAudioCheck, docs/CONTENTBEHEER.md). Een voorgelezen hoofdstuk heeft audio mét
// tijdcodes per vers (`Verse.audioStart`) die bij een bepaalde tekst horen. Verandert een import de tekst van zo'n hoofdstuk, dan wordt
// het hoofdstuk als NEEDS_REVIEW aangemerkt. De audio blijft afspeelbaar en wordt nooit automatisch verwijderd of vervangen; een
// hoofdstuk wordt pas weer CURRENT na nieuwe, gevalideerde audiogegevens of na een expliciete beheerdersbevestiging.

export type AudioCheckReason = "TEXT_CHANGED" | "VERSE_COUNT_CHANGED" | "AUDIO_DATA_INVALID";

export interface AudioCheckDetail {
  reason: AudioCheckReason;
  changedVerses: number[];
  verseCountBefore: number;
  verseCountAfter: number;
}

/** md5 over de verzen in volgorde, gescheiden door een regeleinde; identiek aan de berekening in de migratie 20261127120000. */
export function chapterTextHash(texts: string[]): string {
  return createHash("md5").update(texts.join("\n"), "utf8").digest("hex");
}

/** Welke verzen (1-gebaseerd) zijn anders, inclusief toegevoegde en verdwenen verzen. */
export function changedVerseNumbers(before: string[], after: string[]): number[] {
  const changed: number[] = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) if (before[i] !== after[i]) changed.push(i + 1);
  return changed;
}

export interface AudioTextChange { chapterId: string; hasAudio: boolean; before: string[]; after: string[] }

export interface AudioFlagStats { flagged: number; alreadyFlagged: number; restored: number }

/**
 * Markeert de hoofdstukken waarvan de tekst verandert en die audio hebben (of al een registratie). Aanroepen vóór de verzen worden
 * overschreven: een hoofdstuk zonder registratie krijgt de hash van de OUDE tekst als vastgestelde stand. Schrijft alleen in
 * ChapterAudioCheck; raakt het hoofdstuk, de verzen en de audio zelf nooit aan.
 */
export async function flagAudioForTextChanges(db: Pick<PrismaClient, "chapterAudioCheck">, changes: AudioTextChange[]): Promise<AudioFlagStats> {
  const stats: AudioFlagStats = { flagged: 0, alreadyFlagged: 0, restored: 0 };
  if (changes.length === 0) return stats;
  const existing = new Map((await db.chapterAudioCheck.findMany({ where: { chapterId: { in: changes.map((c) => c.chapterId) } } })).map((row) => [row.chapterId, row]));
  for (const change of changes) {
    const current = existing.get(change.chapterId);
    if (!current && !change.hasAudio) continue;
    const beforeHash = chapterTextHash(change.before);
    const afterHash = chapterTextHash(change.after);
    const approvedHash = current?.textHash ?? beforeHash;
    if (afterHash === approvedHash) {
      // De tekst is terug bij de tekst waar de audio bij hoort: weer in orde.
      if (current && current.status === "NEEDS_REVIEW") {
        await db.chapterAudioCheck.update({ where: { chapterId: change.chapterId }, data: { status: "CURRENT", pendingHash: null, detail: Prisma.JsonNull, flaggedAt: null } });
        stats.restored++;
      }
      continue;
    }
    const detail: AudioCheckDetail = {
      reason: change.before.length !== change.after.length ? "VERSE_COUNT_CHANGED" : "TEXT_CHANGED",
      changedVerses: changedVerseNumbers(change.before, change.after),
      verseCountBefore: change.before.length,
      verseCountAfter: change.after.length,
    };
    if (current?.status === "NEEDS_REVIEW" && current.pendingHash === afterHash) {
      stats.alreadyFlagged++;
      continue;
    }
    await db.chapterAudioCheck.upsert({
      where: { chapterId: change.chapterId },
      create: { chapterId: change.chapterId, status: "NEEDS_REVIEW", textHash: approvedHash, pendingHash: afterHash, detail: detail as unknown as Prisma.InputJsonValue, flaggedAt: new Date() },
      update: { status: "NEEDS_REVIEW", pendingHash: afterHash, detail: detail as unknown as Prisma.InputJsonValue, flaggedAt: new Date() },
    });
    stats.flagged++;
  }
  return stats;
}

/** Verzen van hoofdstukken in volgorde, als tekstlijsten (voor de hash). */
export async function currentChapterTexts(db: Pick<PrismaClient, "verse">, chapterId: string): Promise<string[]> {
  return (await db.verse.findMany({ where: { chapterId }, orderBy: { number: "asc" }, select: { text: true } })).map((v) => v.text);
}

/** Zet een hoofdstuk op CURRENT met de hash van zijn huidige tekst: bij nieuwe, gevalideerde audiogegevens of een beheerdersbevestiging. */
export async function markAudioCurrent(db: Pick<PrismaClient, "chapterAudioCheck" | "verse">, chapterId: string, reviewedById?: string | null): Promise<void> {
  const hash = chapterTextHash(await currentChapterTexts(db, chapterId));
  await db.chapterAudioCheck.upsert({
    where: { chapterId },
    create: { chapterId, status: "CURRENT", textHash: hash, reviewedAt: reviewedById ? new Date() : null, reviewedById: reviewedById ?? null },
    update: { status: "CURRENT", textHash: hash, pendingHash: null, detail: Prisma.JsonNull, flaggedAt: null, reviewedAt: reviewedById ? new Date() : null, reviewedById: reviewedById ?? null },
  });
}

