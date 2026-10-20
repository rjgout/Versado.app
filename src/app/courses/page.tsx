import ProgramLessonPicker from "@/components/study/ProgramLessonPicker";
import ProgramContextPanel from "@/components/study/ProgramContextPanel";
import PageIntro from "@/components/versado/PageIntro";
import LiveRefresh from "@/components/LiveRefresh";
import { getStudyCatalogue } from "@/lib/studyContent/catalogue";
import { getT } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { resolvePersonalStudyMode } from "@/lib/studyContent/personalStudyMode";
import CoursesClient from "@/components/CoursesClient";

export default async function CoursesPage({ searchParams }: { searchParams: Promise<{ weergave?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await getStudyCatalogue(user);
  if (data.context && data.lessons.length) {
    const t = getT(user.uiLanguage);
    return <div data-study-catalogue className="mx-auto flex min-w-0 max-w-3xl flex-col gap-4 pb-6">
      <LiveRefresh scopes={["content","studyContent","studyContext","progress","studySteps"]} token={data.token} staleTime={0}/>
      <PageIntro title={t("managedContent.lessons")}/>
      <ProgramLessonPicker key={`${user.id}:${data.context.workKey}:${data.collectionId}`} data={data} choose mode={resolvePersonalStudyMode((await searchParams).weergave, data.personalMode)} sessionKey={await navigationSessionKey()}/>
    </div>;
  }
  return <><ProgramContextPanel actor={user}/><CoursesClient/></>;
}
