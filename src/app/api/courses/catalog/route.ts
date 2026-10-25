import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { getContentContext } from "@/lib/contentCollections";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { localizedCourse } from "@/lib/courseText";
import { getT } from "@/lib/i18n";
import { apiError } from "@/lib/apiError";
import { courseArtworkKeys } from "@/lib/artwork";
import { courseTypeMatchesContent } from "@/lib/courseContent";

// Cursussen die nog NIET in de persoonlijke lijst staan — voor de "Voeg
// nieuwe cursus toe"-catalogus op /courses (en /courses/per-boek, dat dit
// filtert op BY_BOOK). Een door een admin uitgezette cursus (enabled=false)
// verschijnt hier niet, ongeacht abonneestatus.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const contentContext = await getContentContext(user.id);
  const t = getT(user.uiLanguage);

  const [courses, subscriptions] = await Promise.all([
    prisma.course.findMany({
      where: { enabled: true, contentCollectionId: contentContext.active.id },
      orderBy: { order: "asc" },
      include: {
        _count: { select: { chapters: true } },
        book: { select: { slug: true } },
        contentCollection: { select: { work: true } },
      },
    }),
    prisma.userCourseProgress.findMany({
      where: { userId: user.id, subscribed: true },
      select: { courseId: true },
    }),
  ]);

  const subscribedIds = new Set(subscriptions.map((s) => s.courseId));
  const available = courses.filter((c) => courseTypeMatchesContent(c.type, c.contentCollection.work) && !subscribedIds.has(c.id));

  return NextResponse.json({
    courses: available.map((c) => ({
      id: c.id,
      slug: c.slug,
      type: c.type,
      ...localizedCourse({ ...c, work: c.contentCollection.work }, user.uiLanguage),
      totalChapters: c._count.chapters,
      unitPlural: localizeTerm(chapterTerm(c.book?.slug, c.contentCollectionId), t).plural,
      artwork: courseArtworkKeys({ slug: c.slug, type: c.type, work: c.contentCollection.work }),
    })),
  });
}
