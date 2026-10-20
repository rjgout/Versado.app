import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { prisma } from "@/lib/db";
import { markCfmCourseStarted } from "@/lib/studyContent/cfmCourses";
import { loadPersonalStudyPage } from "@/lib/studyContent/personalStudyPage";
import StudyReader from "@/components/study/StudyReader";
import ReaderBackTarget from "@/components/ReaderBackTarget";
import { getT } from "@/lib/i18n";
import { resolveAnnotationFocus, studyFolderReturn } from "@/lib/annotations/studyFocus";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string; collectionId: string }>;
  searchParams: Promise<{ annotation?: string; returnTo?: string; weergave?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = z
    .object({
      lessonId: z.string().min(1).max(128),
      collectionId: z.string().min(1).max(128),
    })
    .strict()
    .safeParse(await params);
  if (!parsed.success) notFound();
  const sessionKey = await navigationSessionKey();
  const page = await loadPersonalStudyPage(
    user,
    parsed.data.lessonId,
    parsed.data.collectionId,
    sessionKey,
  );
  if (!page) notFound();
  const { reader: data, view } = page;
  const { annotation, returnTo, weergave } = await searchParams;
  const folderReturn = studyFolderReturn(returnTo);
  // Alleen een eigen, actieve annotatie van deze editie; nooit een vrije selector of quote uit de URL.
  const focus = await resolveAnnotationFocus(user, annotation, data.lesson);
  // Een annotatie buiten de persoonlijke studie (of een herstelvoorstel dat daar zou kunnen liggen) blijft bereikbaar via
  // de volledige les; de gebruiker wordt nooit stil naar een andere plek gestuurd.
  const outside =
    !!view &&
    !!focus &&
    (focus.status === "proposal" ||
      focus.status === "orphaned" ||
      (focus.status === "exact" && focus.blockIds.some((id) => !view.personalBlockIds.includes(id))));
  const mode = !view || weergave === "volledig" || outside ? "full" : "free";
  if (mode === "free") await markCfmCourseStarted(prisma, user.id, parsed.data.collectionId, "FREE");
  return (
    <>
      {folderReturn && <ReaderBackTarget href={folderReturn} parent={getT(user.uiLanguage)("studyFolder.title")} soft />}
      <StudyReader
        key={`${data.lesson.editionId}:${sessionKey}:${mode}`}
        initial={data}
        sessionKey={sessionKey}
        annotationFocus={focus}
        personal={{ view, progress: page.progress, week: page.week, mode, stepIndex: null, forcedFull: outside }}
      />
    </>
  );
}
