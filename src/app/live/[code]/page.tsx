import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import GameRoom from "@/components/GameRoom";
import ChapterGuessGameRoom from "@/components/ChapterGuessGameRoom";
import FamilyGameRoom from "@/components/FamilyGameRoom";
import AlleskennerRoom from "@/components/alleskenner/AlleskennerRoom";
import StudyRoom from "@/components/study/StudyRoom";
import FocusLayout from "@/components/versado/FocusLayout";
import { localizedCourse } from "@/lib/courseText";

export default async function LiveGamePage({ params }: { params: Promise<{ code: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { code } = await params;
  const upperCode = code.toUpperCase();

  // Bepaalt hier (server-side) al welke spelmodus dit is, zodat we het
  // juiste client-component renderen. Bestaat de code niet (of nog niet
  // gesynchroniseerd), dan valt dit terug op GameRoom — dat toont zelf al
  // een nette foutmelding zodra de socket "join_game" niets vindt.
  const game = await prisma.liveGame.findUnique({
    where: { code: upperCode },
    select: {
      mode: true,
      studySession: { select: { course: { select: { type: true, name: true, description: true, contentCollection: { select: { work: true } } } } } },
    },
  });

  // Samen spelen met Vliegende {gids} heeft een eigen schermvullende route; de
  // uitnodigingslinks wijzen naar /live/<code> en komen zo vanzelf op de juiste plek.
  if (game?.mode === "QUICK_MISSIONARY") redirect(`/snelle-zendeling/samen/${upperCode}`);

  let content;
  if (game?.mode === "CHAPTER_GUESS") {
    content = <ChapterGuessGameRoom code={upperCode} myUserId={user.id} />;
  } else if (game?.mode === "STUDY" && game.studySession) {
    const course = game.studySession.course;
    const courseName = localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name;
    content = <StudyRoom code={upperCode} myUserId={user.id} courseName={courseName} />;
  } else if (game?.mode === "ALLESKENNER") {
    content = <AlleskennerRoom code={upperCode} />;
  } else if (game?.mode === "FAMILY_GAME") {
    content = <FamilyGameRoom code={upperCode} myUserId={user.id} />;
  } else {
    content = <GameRoom code={upperCode} myUserId={user.id} />;
  }
  return <FocusLayout className="max-w-5xl">{content}</FocusLayout>;
}
