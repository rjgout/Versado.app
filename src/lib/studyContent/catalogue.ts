import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";

/** Normale leslijst onder Leren; geen cursussen aanmaken of voorkeuren wijzigen. */
export async function getStudyCatalogue(actor: {
  id: string;
  isAdmin: boolean;
}) {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { activeContentCollectionId: true },
  });
  if (!user?.activeContentCollectionId)
    return { lessons: [], token: String(Date.now()) };
  const lessons = await prisma.studyLessonEdition.findMany({
    where: {
      collectionId: user.activeContentCollectionId,
      collection: readingAccessWhere(actor),
      publishedRevisionId: { not: null },
      lesson: { retiredAt: null, work: { kind: "STUDY_PROGRAM" } },
    },
    orderBy: [{ lesson: { order: "asc" } }, { id: "asc" }],
    select: {
      id: true,
      lessonId: true,
      collectionId: true,
      publishedRevision: { select: { title: true } },
      lesson: {
        select: { startsOn: true, endsOnExclusive: true, sourceKey: true },
      },
    },
    take: 200,
  });
  return { lessons, token: String(Date.now()) };
}
