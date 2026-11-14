import { studyProgramReview } from "@/lib/studyContent/programReview";
import { withContentUpdateRun } from "@/lib/contentUpdateRun";
import {
  importAllCfmDrafts,
  importCfmDrafts,
} from "@/lib/studyContent/cfm2026Import";
import { autoPublishCfmVolume } from "@/lib/studyContent/cfmAutoPublish";
import { CFM_SOURCES, CFM_SOURCE_2026 } from "@/lib/studyContent/cfmSources";
import { requireCfmApproval } from "@/lib/studyContent/sourceApproval";
import {
  StudyPublishingError,
  type StudyAdmin,
} from "@/lib/studyContent/policy";
import {
  validateCfmRecoveryPlan,
  restoreCfmOriginals,
} from "@/lib/studyContent/cfmRecovery";
import { withContentImportLock } from "@/lib/contentImportLock";
import { mediaDiagnosticText } from "@/lib/studyContent/mediaDiagnostic";
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
    recovery?: { planHash: string; reviewedMedia: boolean };
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

  let partialResult = false;
  let publicationPartial = false;
  const studyLogs: string[] = [];
  const logStudy = (message: string) => {
    current.logs.push(message);
    if (studyLogs.length < 200) studyLogs.push(message);
  };
  const studyImport = study
    ? async () => {
        await requireCfmApproval(study.approvedSnapshot);
        try {
          const actor = await prisma.user.findUnique({
            where: { id: study.actor.id },
            select: { id: true, isAdmin: true },
          });
          if (!actor?.isAdmin) throw new StudyPublishingError("FORBIDDEN");
          if (study.recovery) {
            const plan = await validateCfmRecoveryPlan(
              actor,
              prisma,
              study.recovery.planHash,
              study.recovery.reviewedMedia,
            );
            await restoreCfmOriginals(actor, prisma, plan, (line) =>
              logStudy(line),
            );
            const result = await importCfmDrafts(actor, CFM_SOURCE_2026, {
              client: prisma,
              mode: "append-only",
              recovery: true,
              reviewedMedia: study.recovery.reviewedMedia,
              revisionKeys: plan.revisionKeys,
              progress: (current, total, label) => {
                currentJob.progress = {
                  current,
                  total,
                  label,
                  language: "nl",
                  work: CFM_SOURCE_2026.manifest.workKey,
                };
              },
            });
            const review = await studyProgramReview(
              actor,
              CFM_SOURCE_2026.volume.collectionId,
              prisma,
            );
            publicationPartial = review.blocked > 0 || review.missing > 0;
            for (const lesson of review.lessons)
              for (const issue of lesson.issues)
                if (issue.diagnostic) logStudy(issue.diagnostic);
            logStudy(
              `CFM 2026 voorcontrole: ${review.published} gepubliceerd, ${review.ready} gereed als concept, ${review.blocked} geblokkeerd, ${review.missing} ontbrekend.`,
            );
            logStudy(
              `CFM 2026: ${result.importedLessons} lessen aanwezig, ${result.skippedLessons} ongewijzigd overgeslagen. Alleen concepten voorbereid; niets gepubliceerd of zichtbaar gemaakt. Controleer en publiceer afzonderlijk via Studielespublicaties.`,
            );
            return;
          }
          // Alle geregistreerde jaargangen, chronologisch en idempotent; daarna per jaargang de automatische publicatie van
          // technisch gevalideerde lessen (uitdrukkelijke toestemming van de eigenaar; zie docs/CFM-DOORLOPEND.md). Een
          // mislukte jaargang stopt de volgende niet en laat reeds gepubliceerde lessen ongemoeid.
          let workKey = CFM_SOURCES[0].manifest.workKey;
          const results = await importAllCfmDrafts(study.actor, {
            client: prisma,
            mode: "append-only",
            onVolume: (volume) => {
              workKey = volume.manifest.workKey;
            },
            progress: (current, total, label) => {
              currentJob.progress = {
                current,
                total,
                label,
                language: "nl",
                work: workKey,
              };
            },
          });
          for (const result of results) {
            const volume = CFM_SOURCES.find(
              (s) => s.volume.year === result.year,
            )!;
            if (!result.ok) {
              logStudy(
                `CFM ${result.year}: import mislukt; ${mediaDiagnosticText(result.error) ?? (result.error instanceof StudyPublishingError ? result.error.code : "INCOMPLETE")}`,
              );
              continue;
            }
            partialResult = true;
            if (result.report.allPublished) {
              logStudy(
                `CFM ${result.year}: ${result.report.skippedLessons} reeds gepubliceerde lessen ongewijzigd overgeslagen; geen downloads, herimport of publicatie.`,
              );
              continue;
            }
            const report = await autoPublishCfmVolume(
              study.actor,
              volume,
              prisma,
            );
            publicationPartial ||=
              report.status === "partial" ||
              report.status === "busy" ||
              (report.status === "skipped" && report.reason !== "DISABLED");
            for (const blocked of report.blocked)
              logStudy(
                `CFM ${result.year}; les ${blocked.sourceKey}; ${blocked.diagnostic ?? blocked.codes.join(", ")}`,
              );
            for (const failure of report.failed)
              logStudy(
                `CFM ${result.year}; les ${failure.sourceKey}; ${failure.diagnostic ?? failure.code}`,
              );
            logStudy(
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
          const detail = mediaDiagnosticText(error);
          throw new Error(
            getT(study.actor.uiLanguage)(
              `studyPublishing.errors.${code}` as MessageKey,
            ) + (detail ? ` ${detail}` : ""),
          );
        }
      }
    : undefined;
  const currentJob = current;
  // "Nieuwe content ophalen" laat de Schriftteksten met rust: die lopen via Schriftbronnen bijwerken (controleren, voorbereiden, publiceren).
  const startedMs = Date.now();
  // Zonder duurzame logrij wordt geen import gestart. Ook een andere instance kan de actieve eigenaar herkennen.
  const runPromise = withContentUpdateRun(
    prisma,
    { kind: "CONTENT_UPDATE", createdById: study?.actor.id ?? null },
    async (row) => {
      const record = async (
        status: "OK" | "PARTIAL" | "FAILED",
        error: string | null,
      ) => {
        await prisma.contentUpdateRun.update({
          where: { id: row.id },
          data: {
            status,
            finishedAt: new Date(),
            durationMs: Date.now() - startedMs,
            error,
            sources: [...new Set([...studyLogs, ...current.logs.slice(-50)])],
          },
        });
      };
      try {
        if (study?.recovery) {
          await withContentImportLock(studyImport!);
        } else
          await runSeed(
            prisma,
            (msg) => {
              current.logs.push(msg);
            },
            (progress) => {
              current.progress = progress;
            },
            studyImport,
            { scriptures: false },
          );
        await record(publicationPartial ? "PARTIAL" : "OK", null);
      } catch (error) {
        await record(
          partialResult ? "PARTIAL" : "FAILED",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    },
  )
    .then(() => {
      current.status = "done";
      current.finishedAt = new Date().toISOString();
    })
    .catch((error) => {
      current.status = "error";
      current.error = error instanceof Error ? error.message : String(error);
      current.finishedAt = new Date().toISOString();
    });

  // Ook na een fout halverwege: de oefeningen kunnen dan al zijn bijgewerkt.
  void runPromise.finally(() => clearExercisePlanCache());
  return { started: true, job };
}
