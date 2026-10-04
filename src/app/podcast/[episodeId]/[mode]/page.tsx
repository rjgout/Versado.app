import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { markCourseStarted } from "@/lib/courses";
import { isEmailConfigured } from "@/lib/email";
import PodcastLessonFlow from "@/components/PodcastLessonFlow";
import type { Exercise } from "@/components/LessonFlow";
import { shuffleForDisplay } from "@/lib/exerciseGen";
import CourseBackTarget from "@/components/CourseBackTarget";

export default async function PodcastLessonPage({
  params,
}: {
  params: Promise<{ episodeId: string; mode: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.emailVerifiedAt && (await isEmailConfigured())) {
    redirect("/verify-email");
  }

  const { episodeId, mode: modeParam } = await params;
  if (modeParam !== "CONTENT" && modeParam !== "BOM_CONNECTION") {
    redirect("/courses");
  }
  const mode = modeParam;

  const episode = await prisma.podcastEpisode.findUnique({ where: { id: episodeId } });
  if (!episode) redirect("/courses");

  const exercisesRaw = await prisma.podcastExercise.findMany({
    where: { episodeId, mode },
    orderBy: { order: "asc" },
    include: { options: { orderBy: { order: "asc" } } },
  });
  if (exercisesRaw.length === 0) redirect("/courses");

  const exercises: Exercise[] = exercisesRaw.map((e) => ({
    id: e.id,
    type: e.type as Exercise["type"],
    verseRef: `Aflevering ${episode.number}`,
    prompt: e.prompt,
    blanks: (JSON.parse(e.answers) as string[]).length,
    wordBank: e.wordBank ? shuffleForDisplay(JSON.parse(e.wordBank) as string[]) : undefined,
    options: e.options.length > 0 ? shuffleForDisplay(e.options.map((o) => o.label)) : undefined,
  }));

  // Voor de knoppen op het afrondscherm: terug naar de eigen podcastcursus (niet
  // de algemene cursuslijst), en door naar de andere ronde van deze aflevering
  // zolang die nog niet af is.
  const otherMode = mode === "CONTENT" ? "BOM_CONNECTION" : "CONTENT";
  const [course, otherExerciseCount, otherProgress] = await Promise.all([
    prisma.course.findFirst({ where: { podcastId: episode.podcastId }, select: { id: true, name: true } }),
    prisma.podcastExercise.count({ where: { episodeId, mode: otherMode } }),
    prisma.podcastEpisodeProgress.findUnique({
      where: { userId_episodeId_mode: { userId: user.id, episodeId, mode: otherMode } },
      select: { completed: true },
    }),
  ]);
  if (course) await markCourseStarted(prisma, user.id, course.id);
  const courseHref = course ? `/courses/${course.id}` : "/courses";
  const t = getT(user.uiLanguage);
  const nextRound =
    otherExerciseCount > 0 && !otherProgress?.completed
      ? {
          href: `/podcast/${episode.id}/${otherMode}`,
          label: otherMode === "CONTENT" ? t("lessonFlows.roundContent") : t("lessonFlows.roundBom"),
        }
      : null;

  return (
    <div className="flex flex-col gap-6">
      {course && <CourseBackTarget href={courseHref} parent={course.name} />}
      <div className="max-w-2xl mx-auto w-full">
        <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">
          🎙️ Aflevering {episode.number} — {episode.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {mode === "CONTENT" ? "Inhoud van de aflevering" : "Verband met het Boek van Mormon"}
        </p>
      </div>
      <PodcastLessonFlow
        episodeId={episode.id}
        mode={mode}
        exercises={exercises}
        courseHref={courseHref}
        nextRound={nextRound}
        courseId={course?.id}
      />
    </div>
  );
}
