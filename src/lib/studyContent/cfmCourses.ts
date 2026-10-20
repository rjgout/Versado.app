import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { markCourseStarted } from "@/lib/courses";
import { modeOfStudyCourse, type StudyCourseType } from "@/lib/readingCourses";

/** De CFM-collectie die de importadapter aanmaakt (zie cfm2026Import.ts). */
export const CFM_COLLECTION_ID = "content_cfm_ot_2026_nl";

/**
 * "Kom dan en volg Mij" in Leren: één gewone cursus per leeswijze, net als Stap voor stap en Vrije keuze bij de
 * leescursussen. De volgorde is bewust Stap voor stap eerst: dat is de standaard. De namen staan in het Nederlands
 * (zoals bij syncCourses); andere talen komen uit src/lib/courseText.ts.
 */
export const CFM_COURSES: ReadonlyArray<{ slug: string; type: StudyCourseType; name: string; description: string; order: number }> = [
  { slug: "kom-dan-en-volg-mij-stap-voor-stap", type: "STUDY_STEPS", name: "Stap voor stap", description: "Elke week in zes stappen, in je eigen tempo.", order: 0 },
  { slug: "kom-dan-en-volg-mij-vrije-studie", type: "STUDY_FREE", name: "Vrije studie", description: "De studie van de week als één doorlopende tekst.", order: 1 },
];

/**
 * Maakt de cursussen aan als ze nog niet bestaan. Bestaande rijen blijven ongemoeid (ook een door de beheerder
 * uitgezette cursus), er wordt niemand ingeschreven en niets zichtbaar gemaakt: de collectie zelf bepaalt dat.
 */
export async function ensureCfmCourses(db: Pick<Prisma.TransactionClient, "course">, collectionId: string) {
  for (const course of CFM_COURSES)
    await db.course.upsert({
      where: { slug: course.slug },
      update: {},
      create: { slug: course.slug, type: course.type, name: course.name, description: course.description, order: course.order, contentCollectionId: collectionId },
    });
}

/**
 * Een week of stap openen maakt de bijbehorende cursus (Stap voor stap of Vrije studie) de huidige leerreis, zoals een
 * les openen dat bij de leescursussen doet. Alleen voor een cursus uit het eigen overzicht (markCourseStarted).
 */
export async function markCfmCourseStarted(db: PrismaClient, userId: string, collectionId: string, mode: "STEPS" | "FREE") {
  const course = await db.course.findFirst({
    where: { contentCollectionId: collectionId, enabled: true, type: mode === "STEPS" ? "STUDY_STEPS" : "STUDY_FREE" },
    select: { id: true },
  });
  if (course) await markCourseStarted(db, userId, course.id);
}

export { modeOfStudyCourse };
