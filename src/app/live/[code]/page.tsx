import SharedGame16 from "@/components/ChapterGuessGameRoom";
import SharedGame18 from "@/components/study/StudyRoom";
import SharedGame0 from "@/components/alleskenner/AlleskennerRoom";
import SharedGame17 from "@/components/FamilyGameRoom";
import SharedGame15 from "@/components/GameRoom";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { canResumeLiveGame } from "@/lib/gameAvailability";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";





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
  if (!(await canResumeLiveGame(upperCode))) redirect("/live?availability=unavailable");

  let content;
  if (game?.mode === "CHAPTER_GUESS") {
    content = <GameScreen component={SharedGame16} view="chapterRoom" data={{ "code": upperCode, "myUserId": user.id }}  />;
  } else if (game?.mode === "STUDY" && game.studySession) {
    const course = game.studySession.course;
    const courseName = localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name;
    content = <GameScreen component={SharedGame18} view="studyRoom" data={{ "code": upperCode, "myUserId": user.id, "courseName": courseName }}  />;
  } else if (game?.mode === "ALLESKENNER") {
    content = <GameScreen component={SharedGame0} view="alleskennerRoom" data={{ "code": upperCode }}  />;
  } else if (game?.mode === "FAMILY_GAME") {
    content = <GameScreen component={SharedGame17} view="familyRoom" data={{ "code": upperCode, "myUserId": user.id }}  />;
  } else {
    content = <GameScreen component={SharedGame15} view="quizRoom" data={{ "code": upperCode, "myUserId": user.id }}  />;
  }
  return <WebGameBoundary><FocusLayout className="max-w-5xl">{content}</FocusLayout></WebGameBoundary>;
}
