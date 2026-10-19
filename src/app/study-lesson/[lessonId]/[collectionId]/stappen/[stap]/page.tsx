import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { loadPersonalStudyPage } from "@/lib/studyContent/personalStudyPage";
import StudyReader from "@/components/study/StudyReader";
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
      stap: z.string().regex(/^[1-7]$/),
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
  return (
    <StudyReader
      key={`${page.reader.lesson.editionId}:${sessionKey}:step${stepIndex}`}
      initial={page.reader}
      sessionKey={sessionKey}
      personal={{ view: page.view, progress: page.progress, week: page.week, mode: "step", stepIndex, forcedFull: false }}
    />
  );
}
