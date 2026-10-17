import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getStudyReader } from "@/lib/studyContent/reader";
import StudyReader from "@/components/study/StudyReader";
import ReaderBackTarget from "@/components/ReaderBackTarget";
import { getT } from "@/lib/i18n";
import { resolveAnnotationFocus, studyFolderReturn } from "@/lib/annotations/studyFocus";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string; collectionId: string }>;
  searchParams: Promise<{ annotation?: string; returnTo?: string }>;
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
  const data = await getStudyReader(
    user,
    parsed.data.lessonId,
    parsed.data.collectionId,
    sessionKey,
  );
  if (!data) notFound();
  const { annotation, returnTo } = await searchParams;
  const folderReturn = studyFolderReturn(returnTo);
  // Alleen een eigen, actieve annotatie van deze editie; nooit een vrije selector of quote uit de URL.
  const focus = await resolveAnnotationFocus(user, annotation, data.lesson);
  return (
    <>
      {folderReturn && <ReaderBackTarget href={folderReturn} parent={getT(user.uiLanguage)("studyFolder.title")} soft />}
      <StudyReader
        key={`${data.lesson.editionId}:${sessionKey}`}
        initial={data}
        sessionKey={sessionKey}
        annotationFocus={focus}
      />
    </>
  );
}
