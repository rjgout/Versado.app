import type { PrismaClient } from "@/generated/prisma/client";
import { runSeed } from "@/lib/seed";
import type { OtbImportProgress } from "../../scripts/otb/import-core";

export type ReseedJobStatus = "idle" | "running" | "done" | "error";

export interface ReseedJobState {
  status: ReseedJobStatus;
  logs: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: OtbImportProgress | null;
}

// Eén in-memory jobstatus voor het hele proces — geen losse queue-infra
// nodig voor een taak die een admin af en toe met de hand start (zelfde
// "één Node-proces"-uitgangspunt als src/lib/scheduler.ts/leagues.ts).
//
// Bewust NIET meer aan de HTTP-request van de admin gekoppeld: de vorige
// versie awaitte runSeed binnen de POST-handler zelf. Bij een seed die
// langer duurt dan de timeout van een eventuele reverse proxy (vaak 60s)
// kreeg de admin dan een "er ging iets mis"-melding te zien terwijl het
// seeden op de achtergrond gewoon doorliep én uiteindelijk prima slaagde —
// verwarrend, en precies de klacht die hiermee opgelost wordt. Nu start de
// POST de job en antwoordt meteen; de adminpagina pollt de status hieronder
// totdat de job niet meer "running" is, ongeacht of daartussen genavigeerd
// wordt (de voortgang leeft op de server, niet in React-state).
let job: ReseedJobState = { status: "idle", logs: [], error: null, startedAt: null, finishedAt: null, progress: null };

export function getReseedJob(): ReseedJobState {
  return job;
}

/** Start een nieuwe seed-run, tenzij er al eentje loopt. Wacht niet op afronding. */
export function startReseedJob(prisma: PrismaClient): { started: boolean; job: ReseedJobState } {
  if (job.status === "running") return { started: false, job };

  job = { status: "running", logs: [], error: null, startedAt: new Date().toISOString(), finishedAt: null, progress: null };
  const current = job; // stabiele referentie voor de duur van deze run

  runSeed(prisma, (msg) => {
    current.logs.push(msg);
  }, (progress) => {
    current.progress = progress;
  })
    .then(() => {
      current.status = "done";
      current.finishedAt = new Date().toISOString();
    })
    .catch((e) => {
      current.status = "error";
      current.error = e instanceof Error ? e.message : String(e);
      current.finishedAt = new Date().toISOString();
    });

  return { started: true, job };
}
