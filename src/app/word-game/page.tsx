import SharedGame26 from "@/components/WordGameClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { prisma } from "@/lib/db";
import { canStartGame, canResumeGameContent } from "@/lib/gameAvailability";
import { wordGameDayKey } from "@/lib/wordGame";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";


export default async function WordGamePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const existing = await prisma.wordGame.findUnique({ where: { userId_dayKey: { userId: user.id, dayKey: wordGameDayKey(new Date(), user.timeZone ?? undefined) } }, select: { id: true } });
  if (existing ? !(await canResumeGameContent("content_bom")) : !(await canStartGame(user.id, "word-game"))) redirect("/live?availability=unavailable");
  return <WebGameBoundary><GameScreen component={SharedGame26} view="wordOfDay" data={{  }}  /></WebGameBoundary>;
}
