import { z } from "zod";
import { nativeReaderSchema } from "./readerContract";
import { nativeCourseId as id } from "./coursesContract";

export const readerPositionInput = z.object({
  chapterId: id,
  startVerse: z.number().int().min(1).max(500),
  endVerse: z.number().int().min(1).max(500),
  actionId: z.uuid(),
  expectedVersion: z.number().int().nonnegative().max(2_000_000_000),
  activeCollectionId: id,
  selectionVersion: z.number().int().nonnegative(),
  language: z.enum(["nl", "en", "de", "fr", "es"]),
  verse: z.number().int().min(1).max(500),
}).strict();
export const readerResumeSchema = z.object({
  reader: nativeReaderSchema,
  positionVersion: z.number().int().nonnegative(),
  previous: id.nullable(),
  next: id.nullable(),
}).strict();
export const readerPositionResult = z.object({
  userId: id, activeCollectionId: id, selectionVersion: z.number().int().nonnegative(),
  language: z.enum(["nl", "en", "de", "fr", "es"]),
  courseId: id, kind: z.enum(["steps", "chapters"]), targetId: id,
  actionId: z.uuid(), version: z.number().int().positive(), verse: z.number().int().min(1).max(500),
}).strict();
export type ReaderPositionInput = z.infer<typeof readerPositionInput>;
export type ReaderResume = z.infer<typeof readerResumeSchema>;
