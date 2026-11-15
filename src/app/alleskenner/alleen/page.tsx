import SharedGame1 from "@/components/alleskenner/SoloClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { canStartGame, canResumeGameContent } from "@/lib/gameAvailability";


export default async function AlleskennerSoloPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const allowStarts = await canStartGame(user.id, "alleskenner");
  const hasRun = await prisma.alleskennerSoloRun.count({ where: { userId: user.id, status: "IN_PROGRESS" } });
  if (!allowStarts && (!hasRun || !(await canResumeGameContent("content_bom")))) redirect("/live?availability=unavailable");
  return <WebGameBoundary><GameScreen component={SharedGame1} view="alleskennerSolo" data={{ "myUserId": user.id, "allowStarts": allowStarts }}  /></WebGameBoundary>;
}
