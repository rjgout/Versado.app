import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import {
  requireStudyAdmin,
  StudyPublishingError,
  studyObjectHash,
  type StudyAdmin,
} from "@/lib/studyContent/policy";
import { validateStoredStudyRevision } from "@/lib/studyContent/publication";
import { studyDocumentInventory } from "@/lib/studyContent/fixtureAdapter";
import { resolveReferenceBatch, referenceDiagnosis } from "./resolver";
/** Expliciete beheerreview: uitsluitend diagnoses bijwerken, geen publicatie/voortgang. */
export async function auditStudyReferences(
  actor: StudyAdmin,
  editionId: string,
  revisionId: string,
) {
  requireStudyAdmin(actor);
  return prisma.$transaction(
    async (db) => {
      await db.$executeRaw`SET LOCAL statement_timeout='5s'`;
      await db.$executeRaw`SET LOCAL lock_timeout='5s'`;
      await db.$queryRaw`SELECT id FROM "StudyLessonEdition" WHERE id=${editionId} FOR SHARE`;
      const edition = await db.studyLessonEdition.findFirst({
        where: {
          id: editionId,
          collection: readingAccessWhere(actor, "admin-preview"),
        },
        include: { collection: true },
      });
      const revision =
        edition &&
        (await db.studyRevision.findFirst({
          where: { id: revisionId, lessonEditionId: edition.id },
          include: { references: true },
        }));
      if (!edition || !revision) throw new StudyPublishingError("UNAVAILABLE");
      const inventory = studyDocumentInventory(
        validateStoredStudyRevision(revision).body,
      );
      if (
        inventory.references.length > 200 ||
        inventory.references.length !== revision.references.length
      )
        throw new StudyPublishingError("INCOMPLETE");
      const results = await resolveReferenceBatch(
        db,
        actor,
        {
          workKey: edition.workKey,
          collectionId: edition.collectionId,
          editionKey: edition.collection.editionKey,
          language: edition.collection.language,
        },
        inventory.references.map((r) => ({
          target: r.target,
          diagnosticKey: r.occurrenceKey,
        })),
      );
      const changes = inventory.references.flatMap((source, i) => {
        const stored = revision.references.find(
          (r) => r.occurrenceKey === source.occurrenceKey,
        );
        if (
          !stored ||
          studyObjectHash(stored.originalTarget) !==
            studyObjectHash(source.target)
        )
          throw new StudyPublishingError("INVALID");
        // Gecontroleerde legacy-testfallback blijft ongewijzigd en alleen synthetisch.
        if (stored.evidenceKey === "synthetic-reviewed-reference-v1") return [];
        const result = results[i];
        return [
          {
            id: stored.id,
            ...referenceDiagnosis(result),
          },
        ];
      });
      if (changes.length)
        await db.$executeRaw`UPDATE "ContentReference" r SET diagnosis=a.diagnosis, "evidenceKey"=a."evidenceKey" FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) AS a(id text, diagnosis text, "evidenceKey" text) WHERE r.id=a.id AND r."revisionId"=${revisionId}`;
      return {
        references: changes.map((c) => ({
          id: c.id,
          diagnosis: c.diagnosis,
          evidenceKey: c.evidenceKey,
        })),
      };
    },
    { maxWait: 5000, timeout: 15000 },
  );
}
