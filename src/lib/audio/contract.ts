import { createHash } from "node:crypto";
import { z } from "zod";
import { safeStudyUrlSchema } from "@/lib/studyContent/schema";
import { canonicalJson } from "@/lib/studyContent/revisions";

export const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export const objectHash = (value: unknown) => sha256(canonicalJson(value));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(200);
const file = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}\.mp3$/);
export const packageId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/);
const target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CHAPTER"), bookKey: id, chapterNumber: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("STUDY_REVISION"), revisionId: id }).strict(),
]);
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), packageId,
  collectionId: id, work: id, editionKey: id,
  language: z.enum(["nl", "en", "de", "fr", "es"]), target, sourceHash: hash,
  sourceKind: z.enum(["OFFICIAL", "GENERATED"]),
  source: z.object({ name: id, url: safeStudyUrlSchema.optional(), checkedAt: z.string().datetime({ offset: true }), rights: z.string().min(1).max(4000) }).strict(),
  voice: z.object({ name: id, engine: id.optional(), version: id.optional() }).strict(),
  audio: z.object({ file, sha256: hash, bytes: z.number().int().positive().max(256 * 1024 * 1024), duration: z.number().positive().max(14400), format: z.literal("mp3") }).strict(),
  segments: z.object({ file: z.literal("segments.json"), sha256: hash }).strict(),
  quality: z.enum(["VALIDATED", "NEEDS_REVIEW"]),
  qualityReport: z.object({ file: z.literal("quality-report.json"), sha256: hash }).strict().optional(),
}).strict();
export type AudioManifest = z.infer<typeof manifestSchema>;
export const segmentsSchema = z.object({ schemaVersion: z.literal(1), segments: z.array(z.object({
  id, kind: z.enum(["VERSE", "STUDY_BLOCK"]), sourceHash: hash,
  start: z.number().nonnegative(), end: z.number().positive(),
}).strict()).max(10000) }).strict();
export type AudioSegment = z.infer<typeof segmentsSchema>["segments"][number];
export function chapterSourceHash(chapter: { heading: string | null; verses: { number: number; text: string }[] }) {
  return objectHash({ heading: chapter.heading, verses: chapter.verses.map(({ number, text }) => ({ number, text })) });
}
export function validateSegments(segments: AudioSegment[], expected: { id: string; text: string }[], duration: number) {
  if (segments.length !== expected.length) throw new Error("SEGMENT_COUNT");
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i], verse = expected[i];
    if (segment.kind !== "VERSE" || segment.id !== verse.id || segment.sourceHash !== sha256(verse.text)) throw new Error("SEGMENT_SOURCE");
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start || segment.end > duration || (i > 0 && segments[i - 1].end > segment.start)) throw new Error("SEGMENT_BOUNDS");
  }
}
