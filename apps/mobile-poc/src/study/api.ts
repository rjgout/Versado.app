/* Studieles-spike: les, afbeeldingen en annotaties via de native routes (zod uit src/lib/native) die de bestaande services
 * omhullen. Geen eigen datamodel of annotatieopslag; de server beslist over rechten, versies en plaatsing in de huidige revisie. */
import type { NativeSessionClient } from "@/lib/native/client";
import { nativeCoursesSchema } from "@/lib/native/coursesContract";
import { nativeStudyCourseSchema } from "@/lib/native/studyCoursesContract";
import { nativeStudyImageSchema } from "@/lib/native/studyMediaContract";
import {
  nativeStudyLessonSchema, nativeStudyLessonAnnotationList, nativeStudyLessonAnnotationResult, nativeStudyLessonMutation,
  type NativeStudyLesson, type NativeStudyLessonAnnotation,
} from "@/lib/native/studyLessonContract";
import type { PassageSelector } from "@/lib/annotations/contract";
import { z } from "zod";

export type StudyAnnotation = NativeStudyLessonAnnotation;
export type StudyTombstones = z.infer<typeof nativeStudyLessonAnnotationList>["tombstones"];
export interface StudyBundle { lesson: NativeStudyLesson; annotations: z.infer<typeof nativeStudyLessonAnnotationList> }
const base = (courseId: string, editionId: string) => `courses/${courseId}/weeks/${editionId}`;

/** Cursus "Vrije studie" → de actuele (of eerste) week → het lesdocument en de eigen annotaties. */
export async function loadStudy(client: NativeSessionClient): Promise<StudyBundle> {
  const courses = nativeCoursesSchema.parse(await client.api("courses"));
  const course = [...courses.courses, ...courses.catalog].find(c => c.type === "STUDY_FREE");
  if (!course) throw new Error("study_course_missing");
  const weeks = nativeStudyCourseSchema.parse(await client.api(`courses/${course.id}/weeks`));
  const week = weeks.weeks.find(w => w.id === weeks.activeWeekId) ?? weeks.weeks[0];
  if (!week) throw new Error("study_week_missing");
  return loadLesson(client, course.id, week.id);
}
export async function loadLesson(client: NativeSessionClient, courseId: string, editionId: string): Promise<StudyBundle> {
  const lesson = nativeStudyLessonSchema.parse(await client.api(base(courseId, editionId) + "/lesson"));
  return { lesson, annotations: await loadStudyAnnotations(client, lesson) };
}
export async function loadStudyAnnotations(client: NativeSessionClient, lesson: NativeStudyLesson) {
  return nativeStudyLessonAnnotationList.parse(await client.api(base(lesson.courseId, lesson.editionId) + "/annotations"));
}
/** Een afbeelding via de bestaande beveiligde mediaroute (begrensde webp, base64). */
export async function loadStudyImage(client: NativeSessionClient, mediaId: string) {
  const image = nativeStudyImageSchema.parse(await client.api(`study-media/${mediaId}`));
  return { uri: `data:${image.mimeType};base64,${image.base64}`, width: image.width, height: image.height };
}

const uuid = () => (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID();
const sameSelection = (a: PassageSelector, b: PassageSelector) => JSON.stringify(a.ranges) === JSON.stringify(b.ranges);
const target = (lesson: NativeStudyLesson, selector: PassageSelector) => ({ type: "lesson" as const, lessonEditionId: lesson.editionId, revisionId: lesson.revisionId, selector });

export async function putStudyAnnotation(
  client: NativeSessionClient, lesson: NativeStudyLesson, rows: readonly StudyAnnotation[], tombstones: StudyTombstones, selector: PassageSelector,
  input: { kind: "highlight"; color: "yellow" | "green" | "blue" | "pink" | "purple" } | { kind: "note"; text: string },
) {
  // Dezelfde selectie opnieuw: de bestaande rij (ook een gewiste) levert de verwachte versie, zoals het contract eist.
  const existing = rows.find(r => r.kind === input.kind && sameSelection(r.target.selector, selector)) ?? tombstones.find(r => r.kind === input.kind && sameSelection(r.selector, selector));
  const body = nativeStudyLessonMutation.parse({
    operation: "put",
    action: { kind: input.kind, target: target(lesson, selector), expectedVersion: existing?.mutationVersion ?? 0, actionId: uuid(), ...(input.kind === "highlight" ? { color: input.color } : { text: input.text }) },
  });
  return nativeStudyLessonAnnotationResult.parse(await client.api(base(lesson.courseId, lesson.editionId) + "/annotations", body));
}
export async function deleteStudyAnnotation(client: NativeSessionClient, lesson: NativeStudyLesson, row: StudyAnnotation) {
  const body = nativeStudyLessonMutation.parse({
    operation: "delete",
    action: { kind: row.kind, target: target(lesson, row.target.selector), expectedVersion: row.mutationVersion, actionId: uuid() },
  });
  return nativeStudyLessonAnnotationResult.parse(await client.api(base(lesson.courseId, lesson.editionId) + "/annotations", body));
}

/** Levende markeringen/notities die (een deel van) de selectie raken: blok-id en overlappend codepuntbereik. */
export function overlapping(rows: readonly StudyAnnotation[], kind: StudyAnnotation["kind"], ranges: readonly { blockId: string; start: number; end: number }[]) {
  return rows.filter(r => r.kind === kind && !r.deleted && r.placement?.status === "EXACT" && !!r.placement.selector && r.placement.selector.ranges.some(pr => ranges.some(s => s.blockId === pr.blockId && s.start < pr.end && pr.start < s.end)));
}
