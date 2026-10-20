import { z } from "zod";
import { contentSelectionSchema } from "@/lib/contentPickerContract";
export const referenceTripSchema = z
  .object({
    purpose: z.literal("reference-trip-v1"),
    key: z.uuid(),
    userId: z.string().min(1).max(128),
    sessionKey: z.string().min(1).max(128),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
    lessonId: z.string().min(1).max(128),
    lessonEditionId: z.string().min(1).max(128),
    collectionId: z.string().min(1).max(128),
    revisionId: z.string().min(1).max(128),
    sectionAnchor: z.string().max(128).nullable(),
    blockAnchor: z.string().max(128).nullable(),
    positionVersion: z.number().int().nonnegative(),
    workKey: z.string().min(1).max(128),
    studyVersion: z.number().int().nonnegative(),
    targetStudyWorkKey: z.string().min(1).max(128).nullable(),
    targetStudyVersion: z.number().int().nonnegative().nullable(),
    before: contentSelectionSchema,
    after: contentSelectionSchema,
    beforeVersion: z.number().int().nonnegative().max(2147483647),
    afterVersion: z.number().int().nonnegative().max(2147483647),
    originHref: z
      .string()
      // Vrije studie, de volledige les, het weekoverzicht of een stap van dezelfde les (zie originView.ts).
      .regex(/^\/study-lesson\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?:\/stappen(?:\/[1-6])?|\?weergave=volledig)?$/),
    targetHref: z
      .string()
      .regex(
        /^\/(?:scripture\/[A-Za-z0-9_-]+|study-lesson\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)(?:#[A-Za-z0-9._:-]+)?$/,
      ),
  })
  .strict();
export type ReferenceTrip = z.infer<typeof referenceTripSchema>;
export const REFERENCE_TRIP_TTL_MS = 30 * 60 * 1000;
