/* Lezer-spike: hoofdstuk en annotaties via de bestaande native routes en contracten (zod uit src/lib/native). Geen eigen
 * datamodel, geen eigen annotatieopslag en geen eigen regels: de server beslist (versies, toegang, vergrendeling). */
import type { NativeSessionClient } from "@/lib/native/client";
import { nativeCoursePathSchema, nativeCoursesSchema } from "@/lib/native/coursesContract";
import { nativeReaderSchema, type NativeReader } from "@/lib/native/readerContract";
import {
  nativeAnnotationList,
  nativeAnnotationMutation,
  nativeAnnotationResult,
  type NativeAnnotationList,
} from "@/lib/native/annotationsContract";

export type AnnotationRow = NativeAnnotationList["annotations"][number];
export interface ReaderBundle { reader: NativeReader; annotations: NativeAnnotationList }

const readPath = (reader: Pick<NativeReader, "courseId" | "kind" | "targetId">) => `courses/${reader.courseId}/read/${reader.kind}/${reader.targetId}`;

/** Zoekt het hoofdstuk via de gewone cursusroutes (lijst → pad → lezer). `bookName` kiest een boek; zonder voorkeur het eerste
 * beschikbare hoofdstuk van de cursus "Hoofdstuk voor hoofdstuk". */
export async function loadReader(client: NativeSessionClient, bookName?: string): Promise<NativeReader> {
  const courses = nativeCoursesSchema.parse(await client.api("courses"));
  const course = [...courses.courses, ...courses.catalog].find(c => c.type === "FRONT_TO_BACK");
  if (!course) throw new Error("reader_course_missing");
  const path = nativeCoursePathSchema.parse(await client.api(`courses/${course.id}/path`));
  if (path.kind !== "chapters") throw new Error("reader_path_kind");
  const chapter = path.chapters.find(c => !bookName || c.bookName === bookName) ?? path.chapters[0];
  if (!chapter) throw new Error("reader_chapter_missing");
  return nativeReaderSchema.parse(await client.api(`courses/${course.id}/read/chapters/${chapter.id}`));
}

export async function loadAnnotations(client: NativeSessionClient, reader: NativeReader): Promise<NativeAnnotationList> {
  return nativeAnnotationList.parse(await client.api(`${readPath(reader)}/annotations`));
}

export async function loadBundle(client: NativeSessionClient, bookName?: string): Promise<ReaderBundle> {
  const reader = await loadReader(client, bookName);
  return { reader, annotations: await loadAnnotations(client, reader) };
}

const context = (reader: NativeReader) => ({
  activeCollectionId: reader.activeCollectionId,
  selectionVersion: reader.selectionVersion,
  language: reader.language,
  chapterId: reader.chapterId,
  startVerse: reader.startVerse,
  endVerse: reader.endVerse,
});
const uuid = () => (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
const live = (rows: readonly AnnotationRow[], kind: AnnotationRow["kind"], verseId: string) => rows.find(r => r.kind === kind && r.target.verseId === verseId && !r.deleted);

export type PutInput = { kind: "highlight"; verseId: string; color: "yellow" | "green" | "blue" | "pink" | "purple" } | { kind: "note"; verseId: string; text: string };

/** Zet een markering of notitie op één vers. `expectedVersion` komt uit de bestaande rij (0 bij een nieuwe), zoals het contract eist. */
export async function putAnnotation(client: NativeSessionClient, reader: NativeReader, rows: readonly AnnotationRow[], input: PutInput) {
  const existing = live(rows, input.kind, input.verseId) ?? rows.find(r => r.kind === input.kind && r.target.verseId === input.verseId);
  const body = nativeAnnotationMutation.parse({
    operation: "put",
    context: context(reader),
    action: { kind: input.kind, target: { type: "verse", verseId: input.verseId }, expectedVersion: existing?.mutationVersion ?? 0, actionId: uuid(), ...(input.kind === "highlight" ? { color: input.color } : { text: input.text }) },
  });
  return nativeAnnotationResult.parse(await client.api(`${readPath(reader)}/annotations`, body));
}

export async function deleteAnnotation(client: NativeSessionClient, reader: NativeReader, row: AnnotationRow) {
  const body = nativeAnnotationMutation.parse({
    operation: "delete",
    context: context(reader),
    action: { kind: row.kind, target: { type: "verse", verseId: row.target.verseId }, expectedVersion: row.mutationVersion, actionId: uuid() },
  });
  return nativeAnnotationResult.parse(await client.api(`${readPath(reader)}/annotations`, body));
}

/** Weergave: de eerste levende markering/notitie per vers. */
export function highlightsByVerse(rows: readonly AnnotationRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.kind === "highlight" && !r.deleted && r.color) out[r.target.verseId] = r.color;
  return out;
}
export function notesByVerse(rows: readonly AnnotationRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.kind === "note" && !r.deleted && r.text) out[r.target.verseId] = r.text;
  return out;
}
export { live as liveAnnotation };
