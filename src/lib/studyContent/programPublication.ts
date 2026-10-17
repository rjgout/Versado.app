import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publishStudyRevision } from "./publication";
import { batchActionId, studyProgramReview, type LessonReview } from "./programReview";
import { requireStudyAdmin, StudyPublishingError, type StudyAdmin } from "./policy";
import { studyStorage } from "./storage";

// Gezamenlijke publicatie van een gecontroleerd studieprogramma. Geen tweede publicatiepad: elke les gaat door
// publishStudyRevision met zijn volledige bron-, media-, rechten- en referentievalidatie, versiecontrole en audit.
// Hervatten = dezelfde aanvraag opnieuw; een eerder gepubliceerde les wordt overgeslagen en de actionId per les
// is afgeleid van batch + les + revisie. Er is bewust geen aparte batchtabel: de voortgang volgt uit de editiestand
// en de bestaande publicatie-audit, en blijft dus ook na een herstart of onderbreking betrouwbaar.

export const studyProgramPublishSchema = z
  .object({
    collectionId: z.string().min(1).max(128),
    reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
    batchId: z.uuid(),
    /** De beheerder bevestigt uitdrukkelijk dat hij de gecontroleerde inhoud wil publiceren. */
    confirmReviewed: z.literal(true),
  })
  .strict();
export type StudyProgramPublishRequest = z.infer<typeof studyProgramPublishSchema>;
export type StudyProgramPublishResult = {
  batchId: string;
  total: number;
  published: number;
  remaining: number;
  failed: Array<{ editionId: string; sourceKey: string; title: string; code: string }>;
  done: boolean;
};

// Eén HTTP-verzoek mag niet langer duren dan een gangbare proxytime-out: de voorcontrole plus dit budget blijft ruim onder een minuut.
const STEP_BUDGET_MS = 12_000;

function blockCode(lesson: LessonReview): "MEDIA" | "REFERENCES" | "INCOMPLETE" {
  const first = lesson.issues[0]?.code;
  return first === "MEDIA" || first === "ALT" ? "MEDIA" : first?.startsWith("REFERENCE") || first === "SOURCE" ? "REFERENCES" : "INCOMPLETE";
}

export async function publishStudyProgram(
  actor: StudyAdmin,
  raw: StudyProgramPublishRequest,
  client: PrismaClient = prisma,
  options: { budgetMs?: number } = {},
): Promise<StudyProgramPublishResult> {
  requireStudyAdmin(actor);
  const input = studyProgramPublishSchema.parse(raw);
  await studyStorage();
  const budget = options.budgetMs ?? STEP_BUDGET_MS;
  // Eén batch per programma tegelijk. De lock hangt aan een eigen, lege transactie; de lespublicaties lopen elk in hun
  // eigen transactie met de bestaande locks, dus een gelijktijdige tweede batch krijgt BUSY in plaats van te wachten.
  return client.$transaction(
    async (lock) => {
      const [{ locked }] = await lock.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`study-program-batch:${input.collectionId}`}, 0)) AS locked`;
      if (!locked) throw new StudyPublishingError("BUSY");
      const review = await studyProgramReview(actor, input.collectionId, client);
      // Het tijdsbudget geldt voor het publiceren zelf; de voorcontrole van de hele set telt niet mee.
      const started = Date.now();
      // De beoordeelde set moet exact de set zijn die de server nu kent (andere revisie, import of controlelijst = conflict).
      if (review.reviewToken !== input.reviewToken) throw new StudyPublishingError("CONFLICT");
      if (!review.lessons.length || review.missing > 0 || review.imported < review.expected) throw new StudyPublishingError("INCOMPLETE");
      const blocked = review.lessons.find((l) => l.status === "blocked");
      if (blocked) throw new StudyPublishingError(blockCode(blocked));
      const pending = review.lessons.filter((l) => l.status === "ready");
      const failed: StudyProgramPublishResult["failed"] = [];
      for (const lesson of pending) {
        if (Date.now() - started > budget) break;
        const edition = await client.studyLessonEdition.findUnique({ where: { id: lesson.editionId }, select: { publishedRevisionId: true, draftRevisionId: true, publicationVersion: true } });
        if (!edition || edition.publishedRevisionId === lesson.revisionId) continue;
        try {
          if (!lesson.revisionId || !lesson.importRunId || edition.draftRevisionId !== lesson.revisionId) throw new StudyPublishingError("CONFLICT");
          await publishStudyRevision(
            actor,
            {
              editionId: lesson.editionId,
              revisionId: lesson.revisionId,
              importRunId: lesson.importRunId,
              kind: "PUBLISH",
              expectedVersion: edition.publicationVersion,
              actionId: batchActionId(input.batchId, lesson.editionId, lesson.revisionId),
              // Alleen de exact gecontroleerde lijst; publishStudyRevision herleidt en toetst die zelf opnieuw.
              allowReviewedDisplayOnly: lesson.displayOnlyKeys.length > 0,
            },
            client,
          );
        } catch (error) {
          failed.push({ editionId: lesson.editionId, sourceKey: lesson.sourceKey, title: lesson.title, code: error instanceof StudyPublishingError ? error.code : "INVALID" });
        }
      }
      const after = await client.studyLessonEdition.findMany({ where: { collectionId: input.collectionId, id: { in: pending.map((l) => l.editionId) } }, select: { id: true, publishedRevisionId: true } });
      const publishedNow = pending.filter((l) => after.find((e) => e.id === l.editionId)?.publishedRevisionId === l.revisionId).length;
      const remaining = pending.length - publishedNow;
      return {
        batchId: input.batchId,
        total: review.lessons.length,
        published: review.published + publishedNow,
        remaining,
        failed,
        done: remaining === 0 && failed.length === 0,
      };
    },
    { timeout: budget + 90_000, maxWait: 5000 },
  );
}
