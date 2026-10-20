import ProgramLessonPicker from "@/components/study/ProgramLessonPicker";
import ProgramContextPanel from "@/components/study/ProgramContextPanel";
import PageIntro from "@/components/versado/PageIntro";
import LiveRefresh from "@/components/LiveRefresh";
import { getStudyCatalogue } from "@/lib/studyContent/catalogue";
import { getT } from "@/lib/i18n";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import CoursesClient from "@/components/CoursesClient";

export default async function CoursesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const data = await getStudyCatalogue(user);
  // "Kom dan en volg Mij" is een gewone cursus in Leren (Stap voor stap, Vrije studie): dezelfde kaarten, hetzelfde toevoegen
  // en verbergen als de leescursussen. Alleen overige studieprogramma's (FSY) houden hun eigen lijst.
  if (data.lessons.some((lesson) => lesson.personal)) return <CoursesClient />;
  if (data.context && data.lessons.length) {
    const t = getT(user.uiLanguage);
    return <div data-study-catalogue className="mx-auto flex min-w-0 max-w-3xl flex-col gap-4 pb-6">
      <LiveRefresh scopes={["content","studyContent","studyContext","progress","studySteps"]} token={data.token} staleTime={0}/>
      <PageIntro title={t("managedContent.lessons")}/>
      <ProgramLessonPicker key={`${user.id}:${data.context.workKey}:${data.collectionId}`} data={data} choose/>
    </div>;
  }
  return <><ProgramContextPanel actor={user}/><CoursesClient/></>;
}
