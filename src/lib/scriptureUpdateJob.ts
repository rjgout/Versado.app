import type { PrismaClient } from "@/generated/prisma/client";
import { ContentImportBusyError } from "@/lib/contentImportLock";
import { checkScriptures, mirrorScriptureAudio, publishScriptures, PlanMismatchError, type SourceResult } from "@/lib/contentUpdate";

export type ScriptureAction = "check" | "prepare" | "publish" | "mirror";

export interface ScriptureJobState {
  status: "idle" | "running" | "done" | "error";
  action: ScriptureAction | null;
  runId: string | null;
  planHash: string | null;
  upToDate: boolean | null;
  results: SourceResult[];
  /** Sleutel voor de vertaalde foutmelding; nooit ruwe servertekst voor de gebruiker. */
  errorCode: "BUSY" | "NO_PREPARED_PLAN" | "PLAN_CHANGED" | "FAILED" | null;
  startedAt: string | null;
  finishedAt: string | null;
}

// Eén in-memory job voor het hele proces, zoals reseedJob.ts: de POST antwoordt meteen en de beheerkaart pollt de status.
let job: ScriptureJobState = { status: "idle", action: null, runId: null, planHash: null, upToDate: null, results: [], errorCode: null, startedAt: null, finishedAt: null };

export function getScriptureJob(): ScriptureJobState {
  return job;
}

export function startScriptureJob(client: PrismaClient, action: ScriptureAction, opts: { planHash?: string; adminId?: string | null }): { started: boolean; job: ScriptureJobState } {
  if (job.status === "running") return { started: false, job };
  const current: ScriptureJobState = { status: "running", action, runId: null, planHash: null, upToDate: null, results: [], errorCode: null, startedAt: new Date().toISOString(), finishedAt: null };
  job = current;
  const work = action === "mirror"
    ? mirrorScriptureAudio(client, { adminId: opts.adminId })
    : action === "publish"
    ? publishScriptures(client, { planHash: opts.planHash ?? "", adminId: opts.adminId }).then((outcome) => {
        current.runId = outcome.runId;
        current.results = outcome.results;
      })
    : checkScriptures(client, { prepare: action === "prepare", adminId: opts.adminId }).then((outcome) => {
        current.runId = outcome.runId;
        current.results = outcome.results;
        current.planHash = outcome.planHash;
        current.upToDate = outcome.upToDate;
      });
  void work
    .then(() => { current.status = "done"; })
    .catch((error) => {
      current.status = "error";
      current.errorCode = error instanceof ContentImportBusyError ? "BUSY" : error instanceof PlanMismatchError ? error.reason : "FAILED";
    })
    .finally(() => { current.finishedAt = new Date().toISOString(); });
  return { started: true, job: current };
}
