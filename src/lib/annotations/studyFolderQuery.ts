import { z } from "zod";
import { annotationKind, annotationColor } from "./contract";
export const studyFolderQuery = z.union([
  z.object({ view: z.literal("sources") }).strict(),
  z.object({ item: z.string().regex(/^(bookmark|highlight|note):[A-Za-z0-9_-]{1,128}$/) }).strict(),
  z.object({
    q: z.string().max(400).optional(), type: annotationKind.optional(),
    source: z.string().min(1).max(128).optional(), color: annotationColor.optional(),
    cursor: z.string().min(1).max(400).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }).strict().refine(v => !v.color || !v.type || v.type === "highlight"),
]);
export type StudyFolderQuery = z.infer<typeof studyFolderQuery>;
