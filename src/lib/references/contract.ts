import { z } from "zod";
import type { ReaderDocument } from "@/lib/studyContent/readingPositionContract";
export const referenceRequestSchema = z
  .object({
    lessonEditionId: z.string().min(1).max(128),
    revisionId: z.string().min(1).max(128),
    occurrenceKey: z.string().min(1).max(128),
    visitProof: z.string().max(1500).optional(),
  })
  .strict();
export type ReferenceRequest = z.infer<typeof referenceRequestSchema>;
export type ReferenceResolution =
  | {
      kind: "unavailable";
      reason: "missing" | "edition" | "range" | "unverified" | "too-large";
      diagnosticKey: string;
    }
  | { kind: "external"; url: string; diagnosticKey: string }
  | {
      kind: "internal";
      diagnosticKey: string;
      collectionId: string;
      work: string;
      editionKey: string;
      language: string;
      title: string;
      href: string;
      preview:
        | {
            kind: "scripture";
            chapterId: string;
            verses: Array<{ number: number; text: string }>;
            /** Alleen bij een hoofdstukverwijzing; Meer lezen opent altijd het hele hoofdstuk. */
            truncated?: boolean;
          }
        | {
            kind: "study";
            document: ReaderDocument;
            media: Array<{ mediaKey: string; mediaId: string | null }>;
          };
    };
