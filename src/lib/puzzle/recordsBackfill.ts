import type { PrismaClient } from "@/generated/prisma/client";
import { compareRecords, hintCategoryFor, registerBestRecord, type HintCategory, type RecordMode } from "@/lib/puzzle/records";
import { snapshotSchema } from "@/lib/puzzle/solo";

// Historische persoonlijke records (fase 4): een afzonderlijke, herhaalbare en controleerbare backfill.
//
// - Solo: elke beantwoorde sessie met aantoonbaar goed antwoord en voltooiingstijdstip, plus de historische
//   PuzzlePersonalRecord-rijen (die alleen bij een goed antwoord zijn geschreven). Per sessie is de puzzeltijd
//   completedAt - startedAt en volgen de hints uit de snapshot (of uit de oude recordrij als de snapshot ontbreekt).
// - Wedstrijd: alleen FINISHED deelnemers van regelversie 2 met opgeslagen tijd. Versie 1 (de klok stopte bij het antwoord) is
//   niet vergelijkbaar en wordt nooit overgenomen; INVALID/DNF evenmin.
// - Idempotent: dezelfde comparator als de live registratie (strikt beter); een tweede run verandert niets.
// - Raakt nooit reeksen, hinttegoeden, activiteiten, notificaties of wedstrijdresultaten.

export interface BackfillReport {
  dryRun: boolean;
  solo: { sessionsConsidered: number; adoptedFromSessions: number; unreliableSessions: number; wrongOrUnanswered: number; legacyRows: number; legacyRowsAdopted: number };
  match: { participantsConsidered: number; adopted: number; skippedRulesV1: number; skippedUnreliable: number };
  candidates: number;
  created: number; improved: number; unchanged: number;
  perCategory: Record<string, number>;
}

interface Candidate { userId: string; variantId: string; mode: RecordMode; elapsedMs: number; hintsUsed: number; extraHintsUsed: number; completedAt: Date; sessionId: string; matchParticipantId: string | null }
const key = (c: { userId: string; variantId: string; mode: string; hintsUsed: number }) => `${c.userId}|${c.variantId}|${c.mode}|${hintCategoryFor(c.hintsUsed)}`;
const PAGE = 500;

export async function backfillBestRecords(client: PrismaClient, options: { dryRun?: boolean } = {}): Promise<BackfillReport> {
  const dryRun = options.dryRun !== false;
  const report: BackfillReport = {
    dryRun, solo: { sessionsConsidered: 0, adoptedFromSessions: 0, unreliableSessions: 0, wrongOrUnanswered: 0, legacyRows: 0, legacyRowsAdopted: 0 },
    match: { participantsConsidered: 0, adopted: 0, skippedRulesV1: 0, skippedUnreliable: 0 }, candidates: 0, created: 0, improved: 0, unchanged: 0, perCategory: {},
  };
  const best = new Map<string, Candidate>();
  const consider = (c: Candidate) => { const k = key(c); const current = best.get(k); if (!current || compareRecords(c, current) < 0) best.set(k, c); };
  const seenSessions = new Set<string>();

  // Solo-sessies, in pagina's zodat het geheugen begrensd blijft.
  for (let cursor: string | undefined; ;) {
    const page = await client.puzzleSession.findMany({ where: { mode: "SOLO", status: "ANSWERED" }, orderBy: { id: "asc" }, take: PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), select: { id: true, ownerId: true, variantId: true, snapshot: true, answerResult: true, startedAt: true, completedAt: true } });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    for (const session of page) {
      report.solo.sessionsConsidered++;
      let correct: boolean | null = null;
      try { const parsed = session.answerResult ? JSON.parse(session.answerResult) as { correct?: unknown } : null; correct = typeof parsed?.correct === "boolean" ? parsed.correct : null; } catch { correct = null; }
      if (correct === false) { report.solo.wrongOrUnanswered++; continue; }
      if (correct === null || !session.completedAt) { report.solo.unreliableSessions++; continue; }
      let hints: { extra?: boolean }[];
      try { hints = snapshotSchema.parse(JSON.parse(session.snapshot)).hints; } catch { report.solo.unreliableSessions++; continue; }
      const elapsedMs = session.completedAt.getTime() - session.startedAt.getTime();
      if (!(elapsedMs >= 0)) { report.solo.unreliableSessions++; continue; }
      seenSessions.add(session.id); report.solo.adoptedFromSessions++;
      consider({ userId: session.ownerId, variantId: session.variantId, mode: "SOLO", elapsedMs, hintsUsed: hints.length, extraHintsUsed: hints.filter((hint) => hint.extra).length, completedAt: session.completedAt, sessionId: session.id, matchParticipantId: null });
    }
  }
  // Historische recordrijen: alleen bij een goed antwoord geschreven, dus betrouwbaar; ze vullen ontbrekende sessies aan.
  for (let cursor: string | undefined; ;) {
    const page = await client.puzzlePersonalRecord.findMany({ orderBy: { id: "asc" }, take: PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    for (const row of page) {
      report.solo.legacyRows++;
      if (seenSessions.has(row.sessionId)) continue;
      report.solo.legacyRowsAdopted++;
      consider({ userId: row.userId, variantId: row.variantId, mode: "SOLO", elapsedMs: row.elapsedMs, hintsUsed: row.hintsUsed, extraHintsUsed: row.extraHintsUsed, completedAt: row.completedAt, sessionId: row.sessionId, matchParticipantId: null });
    }
  }
  // Wedstrijden: alleen geldige regelversie-2-finishes.
  for (let cursor: string | undefined; ;) {
    const page = await client.puzzleMatchParticipant.findMany({ where: { status: "FINISHED" }, orderBy: { id: "asc" }, take: PAGE, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), select: { id: true, userId: true, sessionId: true, elapsedMs: true, finishedAt: true, hintsUsed: true, extraHintsUsed: true, match: { select: { variantId: true, resultRules: true } } } });
    if (!page.length) break;
    cursor = page[page.length - 1].id;
    for (const row of page) {
      report.match.participantsConsidered++;
      if (row.match.resultRules < 2) { report.match.skippedRulesV1++; continue; }
      if (row.elapsedMs === null || !row.finishedAt || !row.sessionId || !(row.elapsedMs >= 0)) { report.match.skippedUnreliable++; continue; }
      report.match.adopted++;
      consider({ userId: row.userId, variantId: row.match.variantId, mode: "MATCH", elapsedMs: row.elapsedMs, hintsUsed: row.hintsUsed, extraHintsUsed: row.extraHintsUsed, completedAt: row.finishedAt, sessionId: row.sessionId, matchParticipantId: row.id });
    }
  }

  report.candidates = best.size;
  for (const candidate of best.values()) {
    const category: HintCategory = hintCategoryFor(candidate.hintsUsed);
    report.perCategory[`${candidate.mode}/${category}`] = (report.perCategory[`${candidate.mode}/${category}`] ?? 0) + 1;
    if (dryRun) {
      const existing = await client.puzzleBestRecord.findUnique({ where: { userId_variantId_mode_hintCategory: { userId: candidate.userId, variantId: candidate.variantId, mode: candidate.mode, hintCategory: category } } });
      if (!existing) report.created++;
      else if (compareRecords({ ...candidate, userId: undefined }, { ...existing, userId: undefined }) < 0) report.improved++;
      else report.unchanged++;
      continue;
    }
    const outcome = await client.$transaction((tx) => registerBestRecord(tx, candidate));
    if (outcome.result === "CREATED") report.created++; else if (outcome.result === "IMPROVED") report.improved++; else report.unchanged++;
  }
  return report;
}
