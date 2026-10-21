import type { PrismaClient } from "@/generated/prisma/client";
import { READING_PATH_TYPES, type ReadingPathCourseType } from "./readingCourses";
import { BOM_COLLECTION_ID } from "./contentCollectionIds";

// Invariant: per schriftcollectie maximaal één reguliere cursus per type Stap voor stap (READING_LESSONS), Hoofdstuk voor hoofdstuk
// (FRONT_TO_BACK) en Vrije keuze (FREE_CHOICE). Bewust geen algemene regel op (collectie, type): een collectie mag meerdere
// podcastcursussen hebben. Dit bestand is alleen-lezen en heeft geen afhankelijkheid van de databaseclient van Next.

/** Dezelfde basisslugs als src/lib/courses.ts (letterlijk herhaald: courses.ts importeert dit bestand). */
const BASE_SLUGS: Record<ReadingPathCourseType, string> = {
  FREE_CHOICE: "vrije-keuze",
  FRONT_TO_BACK: "voor-naar-achter",
  READING_LESSONS: "lezen-van-voor-naar-achter",
};

/** De canonieke slug van een leescursus: het Boek van Mormon houdt de historische slug, andere collecties krijgen de collectieslug erachter. */
export function canonicalReadingSlug(collection: { id: string; slug: string }, type: ReadingPathCourseType): string {
  return collection.id === BOM_COLLECTION_ID ? BASE_SLUGS[type] : `${BASE_SLUGS[type]}-${collection.slug}`;
}

export interface DuplicateGroup {
  contentCollectionId: string;
  collectionSlug: string;
  type: ReadingPathCourseType;
  canonicalSlug: string;
  courses: Array<{ id: string; slug: string; name: string; enabled: boolean; order: number; canonical: boolean }>;
}

/** Alle (collectie, type)-combinaties met meer dan één leescursus; leeg = invariant geldt. */
export async function findDuplicateReadingCourses(db: Pick<PrismaClient, "course">): Promise<DuplicateGroup[]> {
  const courses = await db.course.findMany({
    where: { type: { in: [...READING_PATH_TYPES] } },
    select: { id: true, slug: true, name: true, enabled: true, order: true, type: true, contentCollectionId: true, contentCollection: { select: { slug: true } } },
    orderBy: [{ contentCollectionId: "asc" }, { type: "asc" }, { order: "asc" }, { id: "asc" }],
  });
  const groups = new Map<string, DuplicateGroup>();
  for (const course of courses) {
    const type = course.type as ReadingPathCourseType;
    const key = `${course.contentCollectionId}|${type}`;
    const canonicalSlug = canonicalReadingSlug({ id: course.contentCollectionId, slug: course.contentCollection.slug }, type);
    const group = groups.get(key) ?? { contentCollectionId: course.contentCollectionId, collectionSlug: course.contentCollection.slug, type, canonicalSlug, courses: [] };
    group.courses.push({ id: course.id, slug: course.slug, name: course.name, enabled: course.enabled, order: course.order, canonical: course.slug === canonicalSlug });
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.courses.length > 1);
}
