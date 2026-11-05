import { z } from "zod";
import { nativeCourseId as id } from "./coursesContract";
export const NATIVE_READER_MAX_BYTES = 512 * 1024;
export const nativeReaderKind = z.enum(["steps", "chapters"]);
export const nativeReaderSchema = z
  .object({
    version: z.literal(1),
    userId: id,
    activeCollectionId: id,
    selectionVersion: z.number().int().nonnegative(),
    language: z.enum(["nl", "en", "de", "fr", "es"]),
    courseId: id,
    kind: nativeReaderKind,
    targetId: id,
    chapterId: id,
    collectionName: z.string().min(1).max(256),
    bookName: z.string().min(1).max(256),
    chapterNumber: z.number().int().positive(),
    sourceLanguage: z.string().min(2).max(16),
    startVerse: z.number().int().min(1).max(500),
    endVerse: z.number().int().min(1).max(500),
    focusVerse: z.number().int().min(1).max(500),
    verses: z
      .array(
        z
          .object({
            id,
            number: z.number().int().min(1).max(500),
            text: z.string().min(1).max(20_000),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.endVerse < value.startVerse ||
      value.verses.length !== value.endVerse - value.startVerse + 1 ||
      value.verses.some((v, i) => v.number !== value.startVerse + i) ||
      value.focusVerse < value.startVerse ||
      value.focusVerse > value.endVerse ||
      new Set(value.verses.map((v) => v.id)).size !== value.verses.length ||
      new TextEncoder().encode(JSON.stringify(value)).byteLength >
        NATIVE_READER_MAX_BYTES
    )
      ctx.addIssue({ code: "custom", message: "reader_contract_invalid" });
  });
export type NativeReader = z.infer<typeof nativeReaderSchema>;
export type NativeReaderKind = z.infer<typeof nativeReaderKind>;
