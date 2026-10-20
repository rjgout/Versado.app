import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { loadPersonalStudyPage } from "@/lib/studyContent/personalStudyPage";
import StepOverview from "@/components/study/StepOverview";
export default async function Page({
  params,
}: {
  params: Promise<{ lessonId: string; collectionId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = z
    .object({ lessonId: z.string().min(1).max(128), collectionId: z.string().min(1).max(128) })
    .strict()
    .safeParse(await params);
  if (!parsed.success) notFound();
  const sessionKey = await navigationSessionKey();
  const page = await loadPersonalStudyPage(user, parsed.data.lessonId, parsed.data.collectionId, sessionKey);
  if (!page) notFound();
  if (!page.view || !page.progress)
    redirect(`/study-lesson/${encodeURIComponent(parsed.data.lessonId)}/${encodeURIComponent(parsed.data.collectionId)}`);
  return (
    <StepOverview
      key={`${page.reader.lesson.editionId}:${sessionKey}`}
      data={page.reader}
      view={page.view}
      progress={page.progress}
      week={page.week}
      program={page.program}
      sessionKey={sessionKey}
    />
  );
}
