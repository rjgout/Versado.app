import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { getStudyReader } from "@/lib/studyContent/reader";
import StudyReader from "@/components/study/StudyReader";
export default async function Page({
  params,
}: {
  params: Promise<{ lessonId: string; collectionId: string }>;
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
  return (
    <StudyReader
      key={`${data.lesson.editionId}:${sessionKey}`}
      initial={data}
      sessionKey={sessionKey}
    />
  );
}
