import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { loadPersonalStudyPage } from "@/lib/studyContent/personalStudyPage";
import { activeStepIndex } from "@/lib/studyContent/stepProgress";

// Geen tussenpagina: het oude stappenoverzicht stuurt (voor bestaande links en weekkaarten) rechtstreeks naar de stap waar de
// gebruiker verder kan. De stap zelf markeert de cursus als gestart en toont de stapnavigatie.
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
  const base = `/study-lesson/${encodeURIComponent(parsed.data.lessonId)}/${encodeURIComponent(parsed.data.collectionId)}`;
  if (!page.view || !page.progress) redirect(base);
  redirect(`${base}/stappen/${activeStepIndex(page.view.steps, page.progress)}`);
}
