import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { prisma } from "@/lib/db";
import { cfmCoursePathTarget, markCfmCourseStarted } from "@/lib/studyContent/cfmCourses";
import { loadPersonalStudyPage } from "@/lib/studyContent/personalStudyPage";
import StudyReader from "@/components/study/StudyReader";
import ReaderBackTarget from "@/components/ReaderBackTarget";
export default async function Page({
  params,
}: {
  params: Promise<{ lessonId: string; collectionId: string; stap: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = z
    .object({
      lessonId: z.string().min(1).max(128),
      collectionId: z.string().min(1).max(128),
      stap: z.string().regex(/^[1-6]$/),
    })
    .strict()
    .safeParse(await params);
  if (!parsed.success) notFound();
  const sessionKey = await navigationSessionKey();
  const page = await loadPersonalStudyPage(user, parsed.data.lessonId, parsed.data.collectionId, sessionKey);
  if (!page) notFound();
  const base = `/study-lesson/${encodeURIComponent(parsed.data.lessonId)}/${encodeURIComponent(parsed.data.collectionId)}`;
  // Zonder persoonlijke indeling (ander programma of niet verdeelbaar) is er geen stap: toon de gewone lezer.
  if (!page.view) redirect(base);
  const stepIndex = Number(parsed.data.stap);
  await markCfmCourseStarted(prisma, user.id, parsed.data.collectionId, "STEPS");
  // Terug = de werkelijke herkomst (soft: browser-terug); het leerpad is alleen de terugval zonder vorige pagina in de app.
  const back = await cfmCoursePathTarget(prisma, parsed.data.collectionId, "STEPS", user.uiLanguage);
  return (
    <>
      {back && <ReaderBackTarget href={back.href} parent={back.name} soft />}
      <StudyReader
        key={`${page.reader.lesson.editionId}:${sessionKey}:step${stepIndex}`}
        initial={page.reader}
        sessionKey={sessionKey}
        personal={{ view: page.view, progress: page.progress, week: page.week, mode: "step", stepIndex, forcedFull: false, coursePath: back?.href ?? null }}
      />
    </>
  );
}
