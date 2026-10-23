import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { importBooks, type BooksImportStats, type ChapterChange } from "../../prisma/importContent";
import { importChapterAudio } from "../../prisma/importAudio";
import { syncCourses } from "@/lib/courses";
import { clearExercisePlanCache } from "@/lib/learning/contentProgress";
import { withContentImportLock } from "@/lib/contentImportLock";
import { SCRIPTURE_SOURCES, type ScriptureSource } from "@/lib/scriptureSources";

// Beheerflow "Schriftbronnen bijwerken" (docs/CONTENTBEHEER.md §6): Controleren → Voorbereiden → Publiceren.
// Controleren en voorbereiden schrijven nooit naar gebruikerscontent (importBooks met dryRun); publiceren voert exact het
// voorbereide plan uit (planHash) en meldt per bron eerlijk wat gelukt is. Alles draait onder de gedeelde importlock.

export type SourceStatus = "ok" | "skipped" | "error";

export interface SourceCounts {
  chaptersCreated: number;
  chaptersUpdated: number;
  versesCreated: number;
  versesUpdated: number;
  versesDeleted: number;
  exercisesKept: number;
  exercisesCreated: number;
  exercisesRetired: number;
  exercisesDeleted: number;
  audioChapters: number;
  changedChapters: number;
}

export interface SourceResult {
  key: string;
  label: string;
  status: SourceStatus;
  durationMs: number;
  counts: SourceCounts | null;
  message: string | null;
}

export interface ScripturePlanSource {
  key: string;
  counts: SourceCounts;
  /** Alleen de hoofdstukken met een wijziging, in vaste volgorde. */
  changes: ChapterChange[];
}

export interface ScripturePlan {
  sources: ScripturePlanSource[];
}

export function countsOf(stats: BooksImportStats): SourceCounts {
  return {
    chaptersCreated: stats.chapters.created,
    chaptersUpdated: stats.chapters.updated,
    versesCreated: stats.verses.created,
    versesUpdated: stats.verses.updated,
    versesDeleted: stats.verses.deleted,
    exercisesKept: stats.exercises.kept,
    exercisesCreated: stats.exercises.created,
    exercisesRetired: stats.exercises.retired,
    exercisesDeleted: stats.exercises.deleted,
    audioChapters: stats.changes.filter((change) => change.audioAffected).length,
    changedChapters: stats.changes.length,
  };
}

/** Deterministische handtekening van een plan: dezelfde bronbestanden en dezelfde databasestand geven dezelfde hash. */
export function planHashOf(plan: ScripturePlan): string {
  const canonical = plan.sources.map((source) => ({
    key: source.key,
    counts: source.counts,
    changes: [...source.changes].sort((a, b) => a.bookSlug.localeCompare(b.bookSlug) || a.chapter - b.chapter),
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function collectionExists(client: PrismaClient, id: string): Promise<boolean> {
  return (await client.contentCollection.findUnique({ where: { id }, select: { id: true } })) !== null;
}

/** Droogloop over alle bronnen: wat zou er veranderen? Schrijft niets naar de content. */
export async function computeScripturePlan(client: PrismaClient, log: (msg: string) => void = () => undefined, sources: ScriptureSource[] = SCRIPTURE_SOURCES): Promise<{ plan: ScripturePlan; results: SourceResult[] }> {
  const plan: ScripturePlan = { sources: [] };
  const results: SourceResult[] = [];
  for (const source of sources) {
    const started = Date.now();
    if (!(await collectionExists(client, source.id))) {
      results.push({ key: source.id, label: source.label, status: "skipped", durationMs: Date.now() - started, counts: null, message: "collectionMissing" });
      continue;
    }
    try {
      const stats = await importBooks(client, source.books, log, source.id, { syncCourses: false, dryRun: true });
      const counts = countsOf(stats);
      plan.sources.push({ key: source.id, counts, changes: stats.changes });
      results.push({ key: source.id, label: source.label, status: "ok", durationMs: Date.now() - started, counts, message: null });
    } catch (error) {
      results.push({ key: source.id, label: source.label, status: "error", durationMs: Date.now() - started, counts: null, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { plan, results };
}

function aggregateStatus(results: SourceResult[]): "OK" | "PARTIAL" | "FAILED" {
  const errors = results.filter((result) => result.status === "error").length;
  if (errors === 0) return "OK";
  return errors === results.filter((result) => result.status !== "skipped").length ? "FAILED" : "PARTIAL";
}

export interface ScriptureCheckOutcome {
  runId: string;
  status: "OK" | "PARTIAL" | "FAILED";
  results: SourceResult[];
  planHash: string | null;
  upToDate: boolean;
}

/** Controleren (prepare=false) of voorbereiden (prepare=true): beide zijn droogloop; voorbereiden bewaart bovendien het plan en zijn handtekening. */
export async function checkScriptures(client: PrismaClient, opts: { prepare: boolean; adminId?: string | null; log?: (msg: string) => void; sources?: ScriptureSource[] }): Promise<ScriptureCheckOutcome> {
  const run = await client.contentUpdateRun.create({ data: { kind: opts.prepare ? "SCRIPTURE_PREPARE" : "SCRIPTURE_CHECK", createdById: opts.adminId ?? null } });
  const started = Date.now();
  try {
    const { plan, results } = await withContentImportLock(() => computeScripturePlan(client, opts.log, opts.sources));
    const status = aggregateStatus(results);
    // Een plan met een fout in een bron is niet publiceerbaar: de handtekening wordt dan niet gegeven.
    const planHash = opts.prepare && status === "OK" ? planHashOf(plan) : null;
    const upToDate = plan.sources.every((source) => source.counts.changedChapters === 0);
    await client.contentUpdateRun.update({
      where: { id: run.id },
      data: {
        status, finishedAt: new Date(), durationMs: Date.now() - started,
        sources: results as unknown as Prisma.InputJsonValue,
        plan: opts.prepare ? (plan as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        planHash,
      },
    });
    return { runId: run.id, status, results, planHash, upToDate };
  } catch (error) {
    await client.contentUpdateRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

export class PlanMismatchError extends Error {
  constructor(public reason: "NO_PREPARED_PLAN" | "PLAN_CHANGED") {
    super(reason === "NO_PREPARED_PLAN" ? "Er is geen voorbereid plan met deze handtekening." : "De bronnen of de database zijn veranderd sinds de voorbereiding. Bereid opnieuw voor.");
    this.name = "PlanMismatchError";
  }
}

export interface ScripturePublishOutcome { runId: string; status: "OK" | "PARTIAL" | "FAILED"; results: SourceResult[] }

/**
 * Publiceren: alleen met de handtekening van een voorbereid plan, en alleen als het plan nu nog exact hetzelfde is (herberekend onder de
 * lock). Per bron een eigen resultaat; een fout in één bron stopt de andere niet, maar maakt de run PARTIAL/FAILED. Cursussen worden één
 * keer na alle bronnen gesynchroniseerd, ook na een deelfout (wat binnenkwam krijgt zijn lessen).
 */
export async function publishScriptures(client: PrismaClient, opts: { planHash: string; adminId?: string | null; log?: (msg: string) => void; sources?: ScriptureSource[] }): Promise<ScripturePublishOutcome> {
  const log = opts.log ?? (() => undefined);
  const sources = opts.sources ?? SCRIPTURE_SOURCES;
  const prepared = await client.contentUpdateRun.findFirst({ where: { kind: "SCRIPTURE_PREPARE", planHash: opts.planHash, status: "OK" }, orderBy: { startedAt: "desc" }, select: { id: true } });
  if (!prepared) throw new PlanMismatchError("NO_PREPARED_PLAN");
  const run = await client.contentUpdateRun.create({ data: { kind: "SCRIPTURE_PUBLISH", planHash: opts.planHash, createdById: opts.adminId ?? null } });
  const started = Date.now();
  const results: SourceResult[] = [];
  try {
    await withContentImportLock(async () => {
      const { plan, results: dry } = await computeScripturePlan(client, log, sources);
      if (dry.some((result) => result.status === "error") || planHashOf(plan) !== opts.planHash) throw new PlanMismatchError("PLAN_CHANGED");
      try {
        for (const source of sources) {
          const t0 = Date.now();
          const planned = plan.sources.find((entry) => entry.key === source.id);
          if (!planned) { results.push({ key: source.id, label: source.label, status: "skipped", durationMs: 0, counts: null, message: "collectionMissing" }); continue; }
          try {
            const stats = await importBooks(client, source.books, log, source.id, { syncCourses: false });
            if (source.audio) await importChapterAudio(client, source.audio, source.id, log);
            results.push({ key: source.id, label: source.label, status: "ok", durationMs: Date.now() - t0, counts: countsOf(stats), message: null });
          } catch (error) {
            results.push({ key: source.id, label: source.label, status: "error", durationMs: Date.now() - t0, counts: null, message: error instanceof Error ? error.message : String(error) });
          }
        }
      } finally {
        if (results.some((result) => result.status === "ok")) {
          try { await syncCourses(client); } catch (error) {
            results.push({ key: "courses", label: "Cursussen", status: "error", durationMs: 0, counts: null, message: error instanceof Error ? error.message : String(error) });
          }
        }
        clearExercisePlanCache();
      }
    });
    const status = aggregateStatus(results);
    await client.contentUpdateRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), durationMs: Date.now() - started, sources: results as unknown as Prisma.InputJsonValue } });
    return { runId: run.id, status, results };
  } catch (error) {
    await client.contentUpdateRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - started, sources: results as unknown as Prisma.InputJsonValue, error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

/** Het logboek voor de beheerkaart: de laatste runs, nieuwste eerst. */
export async function recentUpdateRuns(client: PrismaClient, kinds: ("CONTENT_UPDATE" | "SCRIPTURE_CHECK" | "SCRIPTURE_PREPARE" | "SCRIPTURE_PUBLISH")[], take = 5) {
  return client.contentUpdateRun.findMany({ where: { kind: { in: kinds } }, orderBy: { startedAt: "desc" }, take });
}
