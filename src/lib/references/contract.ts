import { z } from "zod";
import type { ReaderDocument } from "@/lib/studyContent/readingPositionContract";
export const referenceRequestSchema = z
  .object({
    lessonEditionId: z.string().min(1).max(128),
    revisionId: z.string().min(1).max(128),
    occurrenceKey: z.string().min(1).max(128),
    visitProof: z.string().max(1500).optional(),
    passageIndex: z.number().int().min(0).max(39).optional(),
  })
  .strict();
export type ReferenceRequest = z.infer<typeof referenceRequestSchema>;
export type ReferenceResolution =
  | {
      kind: "unavailable";
      reason: "missing" | "edition" | "range" | "unverified" | "too-large";
      diagnosticKey: string;
    }
  | { kind: "external"; url: string; diagnosticKey: string; language?: "en" }
  | {
      /** Een lofzang uit het eigen zangboek (Lofzangen), gevonden op het officiële lofzang-id; het nummer is de stabiele sleutel. */
      kind: "hymn";
      diagnosticKey: string;
      number: number;
      title: string;
      href: string;
      /** De oorspronkelijke officiële bron, voor als de gebruiker de lofzang liever daar opent. */
      url: string;
    }
  | {
      kind: "internal";
      diagnosticKey: string;
      collectionId: string;
      work: string;
      editionKey: string;
      language: string;
      title: string;
      href: string;
      passages?: Array<{ index: number; title: string }>;
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
