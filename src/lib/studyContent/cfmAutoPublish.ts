import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publishStudyRevision } from "./publication";
import { releaseStudyCollection, studyCollectionReleaseState } from "./collectionRelease";
import { batchActionId, studyProgramReview } from "./programReview";
import { cfmSourceOfCollection, type CfmVolumeSource } from "./cfmSources";
import { requireStudyAdmin, StudyPublishingError, type StudyAdmin } from "./policy";
import { studyStorage } from "./storage";

/**
 * Automatische publicatie van officiële CFM-lessen na technische validatie (uitdrukkelijke toestemming van de projecteigenaar,
 * docs/CFM-DOORLOPEND.md §8). Er is bewust geen tweede publicatiepad: elke les gaat door publishStudyRevision met zijn volledige
 * bron-, media-, rechten- en verwijzingsvalidatie, versiecontrole en audit. Wat hier verandert is alleen dat de beheerder niet
 * meer per les (of per batch) hoeft te bevestigen.
 *
 * Wat dit nooit doet:
 *  - een les publiceren die de voorcontrole blokkeert (onveilige URL, onbekende fout, kapotte structuur, media/rechten);
 *    zo'n les blijft concept en komt met zijn codes in het rapport. De overige lessen worden wel gepubliceerd;
 *  - de zichtbaarheid voor gebruikers aanzetten (`visibleToUsers`): publicatie is geen zichtbaarheid. Dat blijft de bestaande
 *    schakelaar onder Adminbackend → Content;
 *  - iets doen buiten een uitdrukkelijke beheeractie (nooit bij opstarten, deploy of migratie).
 * Een mislukte update laat reeds gepubliceerde lessen ongemoeid: de publicatiewijziging is per les atomair.
 */
export type CfmAutoPublishReport = {
  year: number;
  collectionId: string;
  status: "done" | "partial" | "skipped" | "busy";
  /** Waarom er niets is gepubliceerd (alleen bij `skipped`). */
  reason?: "COLLECTION_MISSING" | "CATALOGUE_INVALID";
  total: number;
  alreadyPublished: number;
  publishedNow: number;
  /** Lessen die de voorcontrole blokkeert; ze blijven concept. */
  blocked: Array<{ sourceKey: string; codes: string[] }>;
  /** Lessen waarvan de publicatie zelf faalde (bv. een gelijktijdige wijziging); ze komen bij een herhaling opnieuw aan bod. */
  failed: Array<{ sourceKey: string; code: string }>;
  /** Aantallen uit de voorcontrole: bewezen verwijzingen en als veilige tekst gepubliceerde (bekend onoplosbare) verwijzingen. */
  references: { total: number; verified: number; displayOnly: number; blocking: number };
  released: boolean;
};

export async function autoPublishCfmVolume(
  actor: StudyAdmin,
  volume: CfmVolumeSource,
  client: PrismaClient = prisma,
): Promise<CfmAutoPublishReport> {
  requireStudyAdmin(actor);
  await studyStorage();
  const base = { year: volume.volume.year, collectionId: volume.volume.collectionId };
  const empty = { total: 0, alreadyPublished: 0, publishedNow: 0, blocked: [], failed: [], references: { total: 0, verified: 0, displayOnly: 0, blocking: 0 }, released: false };
  const collection = await client.contentCollection.findUnique({ where: { id: base.collectionId } });
  if (!collection || cfmSourceOfCollection(collection) !== volume) return { ...base, ...empty, status: "skipped", reason: "COLLECTION_MISSING" };
  // Eén automatische publicatie per jaargang tegelijk (ook tegenover de beheerbatch: dezelfde sleutel).
  return client.$transaction(
    async (lock) => {
      const [{ locked }] = await lock.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`study-program-batch:${base.collectionId}`}, 0)) AS locked`;
      if (!locked) return { ...base, ...empty, status: "busy" as const };
      const review = await studyProgramReview(actor, base.collectionId, client);
      if (!review.catalogueValid) return { ...base, ...empty, total: review.lessons.length, status: "skipped" as const, reason: "CATALOGUE_INVALID" as const };
      const blocked = review.lessons.filter((l) => l.status === "blocked").map((l) => ({ sourceKey: l.sourceKey, codes: [...new Set(l.issues.map((i) => i.code))] }));
      const failed: CfmAutoPublishReport["failed"] = [];
      let publishedNow = 0;
      for (const lesson of review.lessons) {
        if (lesson.status !== "ready" || !lesson.revisionId || !lesson.importRunId) continue;
        try {
          const edition = await client.studyLessonEdition.findUnique({ where: { id: lesson.editionId }, select: { publishedRevisionId: true, draftRevisionId: true, publicationVersion: true } });
          if (!edition || edition.publishedRevisionId === lesson.revisionId) continue;
          if (edition.draftRevisionId !== lesson.revisionId) throw new StudyPublishingError("CONFLICT");
          const result = await publishStudyRevision(
            actor,
            {
              editionId: lesson.editionId,
              revisionId: lesson.revisionId,
              importRunId: lesson.importRunId,
              kind: "PUBLISH",
              expectedVersion: edition.publicationVersion,
              // Dezelfde (les, revisie) levert dezelfde actie op: een herhaling na een onderbreking is idempotent.
              actionId: batchActionId(`cfm-auto:${base.collectionId}`, lesson.editionId, lesson.revisionId),
              // Alleen de uitkomst van de voorcontrole: publishStudyRevision herleidt en toetst die zelf opnieuw.
              allowReviewedDisplayOnly: lesson.displayOnlyKeys.length > 0,
            },
            client,
          );
          if (result.changed) publishedNow += 1;
        } catch (error) {
          failed.push({ sourceKey: lesson.sourceKey, code: error instanceof StudyPublishingError ? error.code : "INVALID" });
        }
      }
      // Inhoudelijke vrijgave van de collectie (niet de zichtbaarheid): alleen als alles gepubliceerd is.
      let released = false;
      const state = await studyCollectionReleaseState(actor, base.collectionId, client);
      if (state.complete && collection.publicationState === "DRAFT" && !collection.visibleToUsers && !blocked.length && !failed.length) {
        try {
          await releaseStudyCollection(actor, { collectionId: base.collectionId, releaseToken: state.releaseToken, actionId: randomUUID() }, client);
          released = true;
        } catch {
          // De vrijgave is een aparte stap; een mislukking laat de gepubliceerde lessen ongemoeid en komt bij herhaling opnieuw.
        }
      }
      const after = await studyProgramReview(actor, base.collectionId, client);
      return {
        ...base,
        status: !blocked.length && !failed.length && after.published === after.lessons.length ? ("done" as const) : ("partial" as const),
        total: after.lessons.length,
        alreadyPublished: after.published - publishedNow,
        publishedNow,
        blocked,
        failed,
        references: { total: after.totals.references, verified: after.totals.referencesVerified, displayOnly: after.totals.displayOnly, blocking: after.totals.blocking },
        released,
      };
    },
    { timeout: 600_000, maxWait: 5000 },
  );
}
