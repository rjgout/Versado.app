import { importAllCfmDrafts } from "@/lib/studyContent/cfm2026Import";
import { autoPublishCfmVolume } from "@/lib/studyContent/cfmAutoPublish";
import { CFM_SOURCES } from "@/lib/studyContent/cfmSources";
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
          // Alle geregistreerde jaargangen, chronologisch en idempotent; daarna per jaargang de automatische publicatie van
          // technisch gevalideerde lessen (uitdrukkelijke toestemming van de eigenaar; zie docs/CFM-DOORLOPEND.md). Een
          // mislukte jaargang stopt de volgende niet en laat reeds gepubliceerde lessen ongemoeid.
          let workKey = CFM_SOURCES[0].manifest.workKey;
          const results = await importAllCfmDrafts(study.actor, {
            client: prisma,
            onVolume: (volume) => {
              workKey = volume.manifest.workKey;
            },
            progress: (current, total, label) => {
              currentJob.progress = { current, total, label, language: "nl", work: workKey };
            },
          });
          for (const result of results) {
            const volume = CFM_SOURCES.find((s) => s.volume.year === result.year)!;
            if (!result.ok) {
              currentJob.logs.push(`CFM ${result.year}: import mislukt`);
              continue;
            }
            const report = await autoPublishCfmVolume(study.actor, volume, prisma);
            currentJob.logs.push(
              `CFM ${result.year}: ${report.status}; ${report.publishedNow} nieuw gepubliceerd, ${report.alreadyPublished} al gepubliceerd, ${report.blocked.length} geblokkeerd, ${report.failed.length} mislukt; ` +
                `${report.madeVisible ? "zichtbaar voor gebruikers; " : ""}verwijzingen: ${report.references.verified} bewezen, ${report.references.displayOnly} als tekst, ${report.references.blocking} blokkerend`,
            );
          }
          // De eerste fout bepaalt de melding (bv. ontbrekende mediaopslag), zodat de beheerder dezelfde code ziet als voorheen.
          const failure = results.find((r) => !r.ok);
          if (failure && !failure.ok) throw failure.error;
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
