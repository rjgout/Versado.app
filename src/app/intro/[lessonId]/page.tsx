import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { markCourseStarted } from "@/lib/courses";
import { isEmailConfigured } from "@/lib/email";
import IntroLessonFlow, { type ResolvedIntroBlock } from "@/components/IntroLessonFlow";
import type { Exercise } from "@/components/LessonFlow";
import type { IntroBlock } from "../../../../prisma/introContent";
import { shuffleForDisplay } from "@/lib/exerciseGen";
import CourseBackTarget from "@/components/CourseBackTarget";

export default async function IntroLessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.emailVerifiedAt && (await isEmailConfigured())) {
    redirect("/verify-email");
  }

  const { lessonId } = await params;
  const lesson = await prisma.introLesson.findUnique({
    where: { id: lessonId },
    include: {
      exercises: { orderBy: { order: "asc" }, include: { options: { orderBy: { order: "asc" } } } },
    },
  });
  if (!lesson) redirect("/courses");

  const rawBlocks = JSON.parse(lesson.content) as IntroBlock[];

  // Personen/boeken/verzen server-side oplossen naar weergavenamen/-tekst,
  // zodat IntroLessonFlow zelf niets hoeft op te vragen behalve PersonCard's
  // eigen, losse detail-fetch bij het openklappen.
  const personSlugs = rawBlocks.flatMap((b) => (b.type === "personTree" ? b.personSlugs : []));
  const bookSlugs = rawBlocks.flatMap((b) => (b.type === "bookList" ? b.bookSlugs : []));

  const [persons, books] = await Promise.all([
    personSlugs.length > 0
      ? prisma.person.findMany({ where: { slug: { in: personSlugs } }, select: { slug: true, name: true } })
      : Promise.resolve([]),
    bookSlugs.length > 0
      ? prisma.book.findMany({ where: { slug: { in: bookSlugs } }, select: { slug: true, name: true } })
      : Promise.resolve([]),
  ]);
  const personBySlug = new Map(persons.map((p) => [p.slug, p]));
  const bookBySlug = new Map(books.map((b) => [b.slug, b]));

  const blocks: ResolvedIntroBlock[] = await Promise.all(
    rawBlocks.map(async (b): Promise<ResolvedIntroBlock> => {
      if (b.type === "personTree") {
        return {
          type: "personTree",
          intro: b.intro,
          persons: b.personSlugs.map((slug) => personBySlug.get(slug) ?? { slug, name: slug }),
        };
      }
      if (b.type === "bookList") {
        return {
          type: "bookList",
          intro: b.intro,
          books: b.bookSlugs.map((slug) => bookBySlug.get(slug) ?? { slug, name: slug }),
        };
      }
      if (b.type === "chapterLink") {
        const chapter = await prisma.chapter.findFirst({
          where: { number: b.chapterNumber, book: { slug: b.bookSlug } },
          include: { book: true },
        });
        if (!chapter) return { type: "readMore", label: b.label, href: "/courses" };
        // Het hoofdstuk opent in een pop-up; wie daarna verder wil, gaat naar
        // het hoofdstuk binnen Vrije keuze, zodat de terugbalk naar die
        // cursus wijst i.p.v. naar de algemene cursuslijst.
        const freeChoice = await prisma.course.findFirst({
          where: {
            type: "FREE_CHOICE",
            enabled: true,
            contentCollectionId: chapter.book.contentCollectionId,
            chapters: { some: { chapterId: chapter.id } },
          },
          select: { id: true, name: true },
        });
        return {
          type: "readMore",
          label: b.label,
          href: freeChoice ? `/lesson/${chapter.id}?cursus=${freeChoice.id}` : `/lesson/${chapter.id}`,
          chapter: {
            id: chapter.id,
            title: `${chapter.book.name} ${chapter.number}`,
            linkLabel: freeChoice ? `Lezen en oefenen in ${freeChoice.name} →` : "Hoofdstuk openen →",
          },
        };
      }
      if (b.type === "scripture") {
        const chapter = await prisma.chapter.findFirst({
          where: { number: b.chapterNumber, book: { slug: b.bookSlug } },
          include: { book: true, verses: { orderBy: { number: "asc" } } },
        });
        const wanted = b.verseNumbers ? new Set(b.verseNumbers) : null;
        const verses = (chapter?.verses ?? [])
          .filter((v) => !wanted || wanted.has(v.number))
          .map((v) => ({ number: v.number, text: v.text }));
        return {
          type: "scripture",
          label: b.label,
          bookName: chapter?.book.name ?? b.bookSlug,
          chapterNumber: b.chapterNumber,
          verses,
        };
      }
      return b;
    })
  );

  const exercises: Exercise[] = lesson.exercises.map((e) => ({
    id: e.id,
    type: e.type as Exercise["type"],
    verseRef: getT(user.uiLanguage)("lessonFlows.lessonNumber", { n: lesson.number }),
    prompt: e.prompt,
    blanks: (JSON.parse(e.answers) as string[]).length,
    wordBank: e.wordBank ? shuffleForDisplay(JSON.parse(e.wordBank) as string[]) : undefined,
    options: e.options.length > 0 ? shuffleForDisplay(e.options.map((o) => o.label)) : undefined,
  }));

  // Na afronden bij voorkeur direct doorlinken naar de volgende les (net als
  // "Volgend hoofdstuk →" bij de reguliere lezer, zie LessonFlow.tsx) i.p.v.
  // terug naar het algemene cursusoverzicht — en anders naar de introcursus
  // zélf (nooit de generieke /courses-lijst van alle cursustypes), zie
  // IntroLessonFlow.tsx.
  const [nextLesson, introCourse] = await Promise.all([
    prisma.introLesson.findFirst({ where: { number: lesson.number + 1 }, select: { id: true } }),
    prisma.course.findFirst({ where: { type: "INTRO" }, select: { id: true, name: true } }),
  ]);
  if (introCourse) await markCourseStarted(prisma, user.id, introCourse.id);

  return (
    <>
    {introCourse && <CourseBackTarget href={`/courses/${introCourse.id}`} parent={introCourse.name} />}
    <IntroLessonFlow
      lessonId={lesson.id}
      number={lesson.number}
      title={lesson.title}
      blocks={blocks}
      exercises={exercises}
      nextLessonId={nextLesson?.id ?? null}
      courseHref={introCourse ? `/courses/${introCourse.id}` : "/courses"}
      courseId={introCourse?.id}
    />
    </>
  );
}
