import SharedGame9 from "@/components/puzzle/PuzzleHistoryClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { getContentContext } from "@/lib/contentCollections";


export default async function PuzzleHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  if ((!settings.jigsawEnabled && !user.isAdmin) || !context.gameKeys.includes("jigsaw")) redirect("/live");
  return <WebGameBoundary><GameScreen component={SharedGame9} view="puzzleHistory" data={{  }}  /></WebGameBoundary>;
}
