import { z } from "zod";
import { nativeCourseId as id } from "./coursesContract";
import { studyDocumentSchema } from "@/lib/studyContent/schema";
import { annotationPutSchema, annotationDeleteSchema, annotationKind, selectorSchema } from "@/lib/annotations/contract";
import { ANNOTATION_COLORS } from "@/lib/annotations/clientContract";

/** Architectuurproef rijke studielessen. Hergebruikt het bestaande documentschema en de bestaande annotatiecontracten;
 * alleen de native verpakking (envelop + begrenzing) is nieuw. */
export const NATIVE_STUDY_LESSON_MAX_BYTES = 2_000_000;
const envelope = { version: z.literal(1), userId: id, activeCollectionId: id.nullable(), selectionVersion: z.number().int().nonnegative(), language: z.enum(["nl", "en", "de", "fr", "es"]), courseId: id, editionId: id };
export const nativeStudyLessonSchema = z.object({
  ...envelope, lessonId: id, collectionId: id, revisionId: id, title: z.string().min(1).max(512),
  body: studyDocumentSchema,
  media: z.array(z.object({ mediaKey: z.string().min(1).max(128), mediaId: id.nullable() }).strict()).max(200),
}).strict().refine(v => new TextEncoder().encode(JSON.stringify(v)).byteLength <= NATIVE_STUDY_LESSON_MAX_BYTES, "lesson_too_large");
/** De server plaatst een annotatie in de huidige revisie: alleen bij EXACT hoort er een selector bij. */
const placement = z.object({ status: z.string().min(1).max(32), selector: selectorSchema.optional() }).strict()
  .refine(p => (p.status === "EXACT") === !!p.selector, "placement_invalid");
export const nativeStudyLessonAnnotationView = z.object({
  id: z.string().min(1).max(128), kind: annotationKind, targetKey: z.string().min(1).max(256),
  target: z.object({ type: z.literal("lesson"), lessonEditionId: id, revisionId: id, selector: selectorSchema }).strict(),
  mutationVersion: z.number().int().nonnegative(), deleted: z.boolean(), anchorStatus: z.string().max(32),
  createdAt: z.string(), updatedAt: z.string().optional(),
  text: z.string().max(2000).optional(), color: z.enum(ANNOTATION_COLORS).nullish(),
  placement: placement.optional(),
}).passthrough();
export const nativeStudyLessonAnnotationList = z.object({ ...envelope, revisionId: id, annotations: z.array(nativeStudyLessonAnnotationView).max(600),
  /** Gewiste annotaties (alleen kind, versie en selector), zodat een client dezelfde selectie opnieuw kan zetten met de juiste verwachte versie. */
  tombstones: z.array(z.object({ kind: annotationKind, mutationVersion: z.number().int().nonnegative(), selector: selectorSchema }).strict()).max(600),
  complete: z.boolean() }).strict();
export const nativeStudyLessonMutation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("put"), action: annotationPutSchema }).strict(),
  z.object({ operation: z.literal("delete"), action: annotationDeleteSchema }).strict(),
]);
export const nativeStudyLessonAnnotationResult = z.object({ ...envelope, revisionId: id, actionId: z.uuid(), changed: z.boolean(), annotation: nativeStudyLessonAnnotationView }).strict();
export type NativeStudyLesson = z.infer<typeof nativeStudyLessonSchema>;
export type NativeStudyLessonAnnotation = z.infer<typeof nativeStudyLessonAnnotationView>;
