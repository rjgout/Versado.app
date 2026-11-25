import SharedGame6 from "@/components/ChapterGuessSetupClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { canStartGame } from "@/lib/gameAvailability";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";


export default async function ChapterGuessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canStartGame(user.id, "chapter-guess"))) redirect("/live?availability=unavailable");
  const availableQuestionCounts = (await Promise.all([5, 10, 15].map(async count => await canStartGame(user.id, "chapter-guess", count) ? count : null))).filter((n): n is number => n !== null);
  return <WebGameBoundary><GameScreen component={SharedGame6} view="chapterSetup" data={{ "availableQuestionCounts": availableQuestionCounts }}  /></WebGameBoundary>;
}
