import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { markCourseStarted } from "@/lib/courses";
import { localizedCourse } from "@/lib/courseText";
import { modeOfStudyCourse, type StudyCourseType } from "@/lib/readingCourses";
import { cfmAnchorCollectionId, cfmAnchorOfCollectionId } from "./cfmProgramme";
import { isPersonalStudyWork } from "./personalStudyOverrides";

/** De CFM-collectie van 2026 (Oude Testament, Nederlands); haar cursussen hebben de oorspronkelijke slugs. */
export const CFM_COLLECTION_ID = "content_cfm_ot_2026_nl";

/**
 * "Kom dan en volg Mij" in Leren: één gewone cursus per leeswijze, net als Stap voor stap en Vrije keuze bij de
 * leescursussen. De volgorde is bewust Stap voor stap eerst: dat is de standaard. De namen staan in het Nederlands
 * (zoals bij syncCourses); andere talen komen uit src/lib/courseText.ts op basis van het cursustype.
 */
export const CFM_COURSE_KINDS: ReadonlyArray<{ type: StudyCourseType; slugSuffix: string; name: string; description: string; order: number }> = [
  { type: "STUDY_STEPS", slugSuffix: "stap-voor-stap", name: "Stap voor stap", description: "Elke week in zes stappen, in je eigen tempo.", order: 0 },
  { type: "STUDY_FREE", slugSuffix: "vrije-studie", name: "Vrije studie", description: "De studie van de week als één doorlopende tekst.", order: 1 },
];

/**
 * De cursusidentiteit is (collectie, leeswijze): één cursus per CFM-collectie en type, onafhankelijk van naam of taal.
 * De slug (wereldwijd uniek) is daar alleen een stabiel, afgeleid label van: de oorspronkelijke slugs voor CFM 2026 (bestaande
 * cursus-ID's, inschrijvingen en voortgang blijven zo dezelfde rijen) en `kom-dan-en-volg-mij-<collectieslug>-<soort>` voor elke
 * andere collectie, zodat een volgend jaar nooit een bestaande rij overschrijft of hergebruikt.
 */
const LEGACY_SLUGS: Readonly<Record<string, Readonly<Partial<Record<StudyCourseType, string>>>>> = {
  [CFM_COLLECTION_ID]: { STUDY_STEPS: "kom-dan-en-volg-mij-stap-voor-stap", STUDY_FREE: "kom-dan-en-volg-mij-vrije-studie" },
};
export function cfmCourseSlug(collection: { id: string; slug: string }, type: StudyCourseType): string {
  const legacy = LEGACY_SLUGS[collection.id]?.[type];
  if (legacy) return legacy;
  const kind = CFM_COURSE_KINDS.find((k) => k.type === type);
  if (!kind) throw new Error(`Onbekend CFM-cursustype ${type}`);
  return `kom-dan-en-volg-mij-${collection.slug}-${kind.slugSuffix}`;
}

/** De twee cursussen van CFM 2026 met hun vaste slugs (voor tests en documentatie). */
export const CFM_COURSES = CFM_COURSE_KINDS.map((kind) => ({ ...kind, slug: cfmCourseSlug({ id: CFM_COLLECTION_ID, slug: "" }, kind.type) }));

/**
 * Maakt de cursussen van één collectie aan als ze nog niet bestaan. Bestaande rijen (op collectie + type) blijven
 * ongemoeid, ook een door de beheerder uitgezette of hernoemde cursus; er wordt niemand ingeschreven en niets zichtbaar
 * gemaakt: de collectie zelf bepaalt dat. Herhaald of gelijktijdig aanroepen levert nooit dubbele cursussen op.
 */
export async function ensureCfmCourses(db: Pick<Prisma.TransactionClient, "course" | "contentCollection">, collection: { id: string; slug: string }) {
  const source = await db.contentCollection.findUnique({ where: { id: collection.id }, select: { work: true, contentWork: { select: { kind: true } } } });
  if (source?.contentWork?.kind !== "STUDY_PROGRAM" || !isPersonalStudyWork(source.work ?? "")) return;
  // Eén programma, één set cursussen: alleen het anker (de eerste jaargang) draagt Stap voor stap en Vrije studie. Een latere
  // jaargang krijgt nooit eigen cursuskaarten; zijn weken zitten in de cursussen van het programma.
  if (cfmAnchorCollectionId(collection) !== collection.id) return;
  for (const kind of CFM_COURSE_KINDS) {
    const existing = await db.course.findFirst({ where: { contentCollectionId: collection.id, type: kind.type }, select: { id: true } });
    if (existing) continue;
    try {
      await db.course.create({
        data: { slug: cfmCourseSlug(collection, kind.type), type: kind.type, name: kind.name, description: kind.description, order: kind.order, contentCollectionId: collection.id },
      });
    } catch (error) {
      // Een gelijktijdige aanroep was ons voor (unieke slug); de rij bestaat dan en is goed.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
}

/**
 * Een week of stap openen maakt de bijbehorende cursus (Stap voor stap of Vrije studie) de huidige leerreis, zoals een
 * les openen dat bij de leescursussen doet. Alleen voor een cursus uit het eigen overzicht (markCourseStarted).
 */
export async function markCfmCourseStarted(db: PrismaClient, userId: string, collectionId: string, mode: "STEPS" | "FREE") {
  const course = await db.course.findFirst({
    where: { contentCollectionId: cfmAnchorOfCollectionId(collectionId), enabled: true, type: mode === "STEPS" ? "STUDY_STEPS" : "STUDY_FREE" },
    select: { id: true },
  });
  if (course) await markCourseStarted(db, userId, course.id);
}

/**
 * Het leerpad (`/courses/<id>/pad`) van de cursus die bij deze collectie en leeswijze hoort. Dit is uitdrukkelijk NIET de
 * bestemming van de terugknop: die volgt de werkelijke herkomst (Vandaag, weekpad, ...) via de browsergeschiedenis, en gebruikt
 * dit pad alleen als veilige terugval zonder bruikbare vorige pagina (directe link, nieuwe tab). Zie docs/CFM-PERSOONLIJKE-STUDIE.md §18.
 * Zonder cursus (nog niet aangemaakt) is er geen bestemming en valt de terugbalk terug op het cursusoverzicht.
 */
export async function cfmCoursePathHref(db: Pick<PrismaClient, "course">, collectionId: string, mode: "STEPS" | "FREE"): Promise<string | null> {
  const course = await db.course.findFirst({
    where: { contentCollectionId: cfmAnchorOfCollectionId(collectionId), enabled: true, type: mode === "STEPS" ? "STUDY_STEPS" : "STUDY_FREE" },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  return course ? `/courses/${course.id}/pad` : null;
}

export async function cfmCoursePathTarget(
  db: Pick<PrismaClient, "course">,
  collectionId: string,
  mode: "STEPS" | "FREE",
  uiLanguage: string,
): Promise<{ href: string; name: string } | null> {
  const course = await db.course.findFirst({
    where: { contentCollectionId: cfmAnchorOfCollectionId(collectionId), type: mode === "STEPS" ? "STUDY_STEPS" : "STUDY_FREE" },
    orderBy: [{ enabled: "desc" }, { order: "asc" }],
    include: { contentCollection: { select: { work: true } } },
  });
  if (!course) return null;
  return { href: `/courses/${course.id}/pad`, name: localizedCourse({ ...course, work: course.contentCollection.work }, uiLanguage).name };
}

export { modeOfStudyCourse };
