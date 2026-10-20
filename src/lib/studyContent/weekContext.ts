import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";

type Actor = { id: string; isAdmin: boolean };
export interface WeekLink {
  lessonId: string;
  collectionId: string;
  title: string;
}
export interface WeekContext {
  /** Officiële weekperiode als kalenderdagen (zonder tijdzone); eind exclusief. */
  startsOn: string | null;
  endsOnExclusive: string | null;
  prev: WeekLink | null;
  next: WeekLink | null;
  index: number;
  total: number;
}

/**
 * Vorige en volgende gepubliceerde les van hetzelfde programma en dezelfde collectie, in de volgorde van het
 * programma. Alleen lessen die deze gebruiker mag lezen; er wordt nooit een week verzonnen of overgeslagen.
 */
export async function getLessonWeekContext(
  actor: Actor,
  lesson: { lessonId: string; collectionId: string },
): Promise<WeekContext> {
  const editions = await prisma.studyLessonEdition.findMany({
    where: {
      collectionId: lesson.collectionId,
      collection: readingAccessWhere(actor),
      publishedRevisionId: { not: null },
      lesson: { retiredAt: null },
    },
    orderBy: [{ lesson: { order: "asc" } }, { id: "asc" }],
    select: {
      lessonId: true,
      collectionId: true,
      publishedRevision: { select: { title: true } },
      lesson: { select: { startsOn: true, endsOnExclusive: true } },
    },
    take: 201,
  });
  const at = editions.findIndex((e) => e.lessonId === lesson.lessonId);
  const link = (i: number): WeekLink | null =>
    i >= 0 && i < editions.length && editions[i].publishedRevision
      ? { lessonId: editions[i].lessonId, collectionId: editions[i].collectionId, title: editions[i].publishedRevision!.title }
      : null;
  const current = at >= 0 ? editions[at].lesson : null;
  return {
    startsOn: current?.startsOn?.toISOString().slice(0, 10) ?? null,
    endsOnExclusive: current?.endsOnExclusive?.toISOString().slice(0, 10) ?? null,
    prev: link(at - 1),
    next: link(at + 1),
    index: at + 1,
    total: editions.length,
  };
}
