import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { importBooks, type BooksImportStats, type ChapterChange } from "../../prisma/importContent";
import { importChapterAudio } from "../../prisma/importAudio";
import { syncCourses } from "@/lib/courses";
import { clearExercisePlanCache } from "@/lib/learning/contentProgress";
import { withContentImportLock } from "@/lib/contentImportLock";
import { SCRIPTURE_SOURCES, type ScriptureSource } from "@/lib/scriptureSources";
import { importOtbFull, type OtbCollectionChange } from "../../scripts/otb/import-core";
import { cachedPinnedOtbSource, preparePinnedOtbSource } from "../../scripts/otb/source";
import { OTB_COLLECTIONS } from "../../scripts/otb/trialConfig";
import { mirrorChapterAudio } from "@/lib/audioMirror";

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
  /** sha256 over de volledige broninhoud (boeken, verzen, koppen en audiotijden): verandert er één teken in de bron, dan verandert dit. */
  sourceDigest: string;
  /** md5 over de relevante databasestand van de collectie (verzen, hoofdstukken, oefeningstatus, audiocontrole). Zie `collectionFingerprint`. */
  dbFingerprint: string;
}

export interface ScriptureOtbPlan {
  contentDigest: string;
  changes: OtbCollectionChange[];
  dbFingerprint: string;
}

export interface ScripturePlan {
  sources: ScripturePlanSource[];
  otb: ScriptureOtbPlan | null;
}

/** Waar de gepinde OTB-bron vandaan komt. `download` is alleen waar bij voorbereiden; controleren en publiceren downloaden nooit. */
export interface OtbSourceProvider { resolve(download: boolean, log: (msg: string) => void): Promise<string | null> }

export const defaultOtbProvider: OtbSourceProvider = {
  resolve: (download, log) => (download ? preparePinnedOtbSource(log) : cachedPinnedOtbSource()),
};

const digestCache = new WeakMap<ScriptureSource, string>();

export function sourceDigestOf(source: ScriptureSource): string {
  const cached = digestCache.get(source);
  if (cached) return cached;
  const digest = createHash("sha256").update(JSON.stringify({ books: source.books, audio: source.audio ?? null })).digest("hex");
  digestCache.set(source, digest);
  return digest;
}

/**
 * Databasestand van de collectie voor zover die het plan bepaalt: verzen (id, nummer, tekst-hash, audiotijd), hoofdstukken (kop, audio), oefeningen (id, status)
 * en de audiocontrole. Gebruiksgegevens (pogingen, sessies) horen er bewust niet bij: die wijzigen continu en de import vangt ze zelf af in de transactie.
 */
export async function collectionFingerprint(client: PrismaClient, collectionIds: string[]): Promise<string> {
  const rows = await client.$queryRaw<{ h: string }[]>(Prisma.sql`
    SELECT md5(coalesce(string_agg(x, '|' ORDER BY x), '')) AS h FROM (
      SELECT 'v' || v.id || ':' || v.number || ':' || md5(v.text) || ':' || coalesce(v."audioStart"::text, '') AS x
        FROM "Verse" v JOIN "Chapter" c ON c.id = v."chapterId" JOIN "Book" b ON b.id = c."bookId" WHERE b."contentCollectionId" IN (${Prisma.join(collectionIds)})
      UNION ALL
      SELECT 'c' || c.id || ':' || c.number || ':' || c."order" || ':' || coalesce(c.heading, '') || ':' || coalesce(c."audioUrl", '') || ':' || coalesce(c."audioHeadingStart"::text, '') || ':' || coalesce(c."audioHeadingEnd"::text, '')
        FROM "Chapter" c JOIN "Book" b ON b.id = c."bookId" WHERE b."contentCollectionId" IN (${Prisma.join(collectionIds)})
      UNION ALL
      SELECT 'e' || e.id || ':' || e.status::text
        FROM "Exercise" e JOIN "Chapter" c ON c.id = e."chapterId" JOIN "Book" b ON b.id = c."bookId" WHERE b."contentCollectionId" IN (${Prisma.join(collectionIds)})
      UNION ALL
      SELECT 'a' || a."chapterId" || ':' || a.status::text || ':' || coalesce(a."pendingHash", '') || ':' || a."textHash"
        FROM "ChapterAudioCheck" a JOIN "Chapter" c ON c.id = a."chapterId" JOIN "Book" b ON b.id = c."bookId" WHERE b."contentCollectionId" IN (${Prisma.join(collectionIds)})
    ) t`);
  return rows[0]?.h ?? "";
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
  const canonical = {
    sources: plan.sources.map((source) => ({
      key: source.key,
      counts: source.counts,
      changes: [...source.changes].sort((a, b) => a.bookSlug.localeCompare(b.bookSlug) || a.chapter - b.chapter),
      sourceDigest: source.sourceDigest,
      dbFingerprint: source.dbFingerprint,
    })),
    otb: plan.otb,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function collectionExists(client: PrismaClient, id: string): Promise<boolean> {
  return (await client.contentCollection.findUnique({ where: { id }, select: { id: true } })) !== null;
}

export interface PlanOptions {
  log?: (msg: string) => void;
  sources?: ScriptureSource[];
  /** undefined = de gepinde OTB-bron; null = geen Bijbel in dit plan (tests). */
  otb?: OtbSourceProvider | null;
}

const OTB_KEY = "otb";
const OTB_LABEL = "Bijbel (Open Translation Bible)";

function otbCounts(changes: OtbCollectionChange[]): SourceCounts {
  const sum = (pick: (change: OtbCollectionChange) => number) => changes.reduce((total, change) => total + pick(change), 0);
  return {
    chaptersCreated: sum((c) => c.chaptersNew), chaptersUpdated: sum((c) => c.chaptersChanged), versesCreated: 0, versesUpdated: sum((c) => c.versesChanged), versesDeleted: 0,
    exercisesKept: 0, exercisesCreated: 0, exercisesRetired: 0, exercisesDeleted: 0, audioChapters: 0, changedChapters: sum((c) => c.chaptersNew + c.chaptersChanged),
  };
}

/**
 * Droogloop over alle bronnen, inclusief de gepinde OTB-bijbel: wat zou er veranderen? Schrijft niets naar de content. De OTB-bron wordt hier nooit
 * gedownload (`otbRoot` is het resultaat van de aparte bronvoorbereiding); ontbreekt hij, dan staat de Bijbel als "overgeslagen" in het resultaat.
 */
export async function computeScripturePlan(client: PrismaClient, otbRoot: string | null, opts: PlanOptions = {}): Promise<{ plan: ScripturePlan; results: SourceResult[] }> {
  const log = opts.log ?? (() => undefined);
  const sources = opts.sources ?? SCRIPTURE_SOURCES;
  const plan: ScripturePlan = { sources: [], otb: null };
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
      plan.sources.push({ key: source.id, counts, changes: stats.changes, sourceDigest: sourceDigestOf(source), dbFingerprint: await collectionFingerprint(client, [source.id]) });
      results.push({ key: source.id, label: source.label, status: "ok", durationMs: Date.now() - started, counts, message: null });
    } catch (error) {
      results.push({ key: source.id, label: source.label, status: "error", durationMs: Date.now() - started, counts: null, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (opts.otb !== null) {
    const started = Date.now();
    if (!otbRoot) {
      results.push({ key: OTB_KEY, label: OTB_LABEL, status: "skipped", durationMs: 0, counts: null, message: "otbNotPrepared" });
    } else {
      try {
        const result = await importOtbFull(client, otbRoot, log, undefined, { dryRun: true });
        const ids = OTB_COLLECTIONS.map((collection) => collection.id);
        plan.otb = { contentDigest: result.contentDigest, changes: result.changes, dbFingerprint: await collectionFingerprint(client, ids) };
        results.push({ key: OTB_KEY, label: OTB_LABEL, status: "ok", durationMs: Date.now() - started, counts: otbCounts(result.changes), message: null });
      } catch (error) {
        results.push({ key: OTB_KEY, label: OTB_LABEL, status: "error", durationMs: Date.now() - started, counts: null, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { plan, results };
}

function aggregateStatus(results: SourceResult[]): "OK" | "PARTIAL" | "FAILED" {
  const errors = results.filter((result) => result.status === "error").length;
  if (errors === 0) return "OK";
  return errors === results.filter((result) => result.status !== "skipped").length ? "FAILED" : "PARTIAL";
}

async function resolveOtbRoot(opts: PlanOptions, download: boolean): Promise<{ root: string | null; error: string | null }> {
  if (opts.otb === null) return { root: null, error: null };
  try {
    return { root: await (opts.otb ?? defaultOtbProvider).resolve(download, opts.log ?? (() => undefined)), error: null };
  } catch (error) {
    return { root: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface ScriptureCheckOutcome {
  runId: string;
  status: "OK" | "PARTIAL" | "FAILED";
  results: SourceResult[];
  planHash: string | null;
  upToDate: boolean;
}

/**
 * Controleren (prepare=false) of voorbereiden (prepare=true): beide zijn droogloop; voorbereiden bewaart bovendien het plan en zijn handtekening.
 * Alleen voorbereiden downloadt de gepinde OTB-bron (aparte bronvoorbereiding, vóór de lock, zodat een trage download de import niet blokkeert);
 * controleren gebruikt wat er al staat.
 */
export async function checkScriptures(client: PrismaClient, opts: PlanOptions & { prepare: boolean; adminId?: string | null }): Promise<ScriptureCheckOutcome> {
  const run = await client.contentUpdateRun.create({ data: { kind: opts.prepare ? "SCRIPTURE_PREPARE" : "SCRIPTURE_CHECK", createdById: opts.adminId ?? null } });
  const started = Date.now();
  try {
    const otb = await resolveOtbRoot(opts, opts.prepare);
    const { plan, results } = await withContentImportLock(() => computeScripturePlan(client, otb.root, opts));
    if (otb.error) results.splice(0, results.length, ...results.filter((result) => result.key !== OTB_KEY));
    if (otb.error) results.push({ key: OTB_KEY, label: OTB_LABEL, status: "error", durationMs: 0, counts: null, message: otb.error });
    const status = aggregateStatus(results);
    // Een plan met een fout in een bron is niet publiceerbaar: de handtekening wordt dan niet gegeven.
    const planHash = opts.prepare && status === "OK" ? planHashOf(plan) : null;
    const upToDate = plan.sources.every((source) => source.counts.changedChapters === 0) && (plan.otb?.changes.length ?? 0) === 0;
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
 * lock, inhoudsgebonden: broninhoud en relevante databasestand). Per bron een eigen resultaat; een fout in één bron stopt de andere niet,
 * maar maakt de run PARTIAL/FAILED. Cursussen worden één keer na alle bronnen gesynchroniseerd, ook na een deelfout (wat binnenkwam krijgt
 * zijn lessen). Er wordt niets gedownload of gespiegeld: de OTB-bron moet al voorbereid zijn.
 */
export async function publishScriptures(client: PrismaClient, opts: PlanOptions & { planHash: string; adminId?: string | null }): Promise<ScripturePublishOutcome> {
  const log = opts.log ?? (() => undefined);
  const sources = opts.sources ?? SCRIPTURE_SOURCES;
  const prepared = await client.contentUpdateRun.findFirst({ where: { kind: "SCRIPTURE_PREPARE", planHash: opts.planHash, status: "OK" }, orderBy: { startedAt: "desc" }, select: { id: true } });
  if (!prepared) throw new PlanMismatchError("NO_PREPARED_PLAN");
  const run = await client.contentUpdateRun.create({ data: { kind: "SCRIPTURE_PUBLISH", planHash: opts.planHash, createdById: opts.adminId ?? null } });
  const started = Date.now();
  const results: SourceResult[] = [];
  try {
    const otb = await resolveOtbRoot(opts, false);
    await withContentImportLock(async () => {
      const { plan, results: dry } = await computeScripturePlan(client, otb.root, opts);
      if (otb.error || dry.some((result) => result.status === "error") || planHashOf(plan) !== opts.planHash) throw new PlanMismatchError("PLAN_CHANGED");
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
        if (plan.otb && otb.root) {
          const t0 = Date.now();
          try {
            await importOtbFull(client, otb.root, log);
            results.push({ key: OTB_KEY, label: OTB_LABEL, status: "ok", durationMs: Date.now() - t0, counts: otbCounts(plan.otb.changes), message: null });
          } catch (error) {
            results.push({ key: OTB_KEY, label: OTB_LABEL, status: "error", durationMs: Date.now() - t0, counts: null, message: error instanceof Error ? error.message : String(error) });
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

/** Audiobestanden van de voorgelezen hoofdstukken lokaal spiegelen: een aparte, bewuste actie, nooit onderdeel van een normale contentupdate of Schriftpublicatie. */
export async function mirrorScriptureAudio(client: PrismaClient, opts: { adminId?: string | null; log?: (msg: string) => void } = {}): Promise<void> {
  await withContentImportLock(() => mirrorChapterAudio(client, opts.log ?? (() => undefined)));
}

/** Het logboek voor de beheerkaart: de laatste runs, nieuwste eerst. */
export async function recentUpdateRuns(client: PrismaClient, kinds: ("CONTENT_UPDATE" | "SCRIPTURE_CHECK" | "SCRIPTURE_PREPARE" | "SCRIPTURE_PUBLISH")[], take = 5) {
  return client.contentUpdateRun.findMany({ where: { kind: { in: kinds } }, orderBy: { startedAt: "desc" }, take });
}

/**
 * Een run die RUNNING blijft terwijl er in dit proces geen taak loopt, is onderbroken (herstart of crash): de lock vervalt vanzelf met de
 * verbinding, maar de logrij zou eeuwig "bezig" blijven. Alleen aanroepen als de aanroeper zeker weet dat er geen eigen taak loopt.
 */
export async function markInterruptedRuns(client: PrismaClient): Promise<number> {
  const result = await client.contentUpdateRun.updateMany({
    where: { status: "RUNNING", startedAt: { lt: new Date(Date.now() - 5_000) } },
    data: { status: "FAILED", finishedAt: new Date(), error: "INTERRUPTED" },
  });
  return result.count;
}
