import { importCfm2026Drafts } from "@/lib/studyContent/cfm2026Import";
import { requireCfmApproval } from "@/lib/studyContent/sourceApproval";
import {
  StudyPublishingError,
  type StudyAdmin,
} from "@/lib/studyContent/policy";
import { getT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/core";
import type { PrismaClient } from "@/generated/prisma/client";
import { runSeed } from "@/lib/seed";
import { clearExercisePlanCache } from "@/lib/learning/contentProgress";
import type { OtbImportProgress } from "../../scripts/otb/import-core";

export type ReseedJobStatus = "idle" | "running" | "done" | "error";

export interface ReseedJobState {
  status: ReseedJobStatus;
  logs: string[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress:
    | (Pick<OtbImportProgress, "current" | "total" | "label" | "language"> & {
        work: string;
      })
    | null;
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
let job: ReseedJobState = {
  status: "idle",
  logs: [],
  error: null,
  startedAt: null,
  finishedAt: null,
  progress: null,
};

export function getReseedJob(): ReseedJobState {
  return job;
}

/** Start een nieuwe seed-run, tenzij er al eentje loopt. Wacht niet op afronding. */
export function startReseedJob(
  prisma: PrismaClient,
  study?: {
    actor: StudyAdmin & { uiLanguage?: string };
    approvedSnapshot: string;
  },
): { started: boolean; job: ReseedJobState } {
  if (job.status === "running") return { started: false, job };

  job = {
    status: "running",
    logs: [],
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: null,
  };
  const current = job; // stabiele referentie voor de duur van deze run

  const studyImport = study
    ? async () => {
        await requireCfmApproval(study.approvedSnapshot);
        try {
          await importCfm2026Drafts(study.actor, {
            client: prisma,
            progress: (current, total, label) => {
              currentJob.progress = {
                current,
                total,
                label,
                language: "nl",
                work: "cfm-old-testament-2026",
              };
            },
          });
        } catch (error) {
          const code =
            error instanceof StudyPublishingError ? error.code : "INCOMPLETE";
          throw new Error(
            getT(study.actor.uiLanguage)(
              `studyPublishing.errors.${code}` as MessageKey,
            ),
          );
        }
      }
    : undefined;
  const currentJob = current;
  const runPromise = runSeed(
    prisma,
    (msg) => {
      current.logs.push(msg);
    },
    (progress) => {
      current.progress = progress;
    },
    studyImport,
  )
    .then(() => {
      current.status = "done";
      current.finishedAt = new Date().toISOString();
    })
    .catch((e) => {
      current.status = "error";
      current.error = e instanceof Error ? e.message : String(e);
      current.finishedAt = new Date().toISOString();
    });

  // Ook na een fout halverwege: de oefeningen kunnen dan al zijn bijgewerkt.
  void runPromise.finally(() => clearExercisePlanCache());
  return { started: true, job };
}
