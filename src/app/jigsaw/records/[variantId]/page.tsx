import SharedGame11 from "@/components/puzzle/LeaderboardClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { getContentContext } from "@/lib/contentCollections";


export default async function PuzzleLeaderboardPage({ params, searchParams }: { params: Promise<{ variantId: string }>; searchParams: Promise<{ mode?: string; cat?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  if ((!settings.jigsawEnabled && !user.isAdmin) || !context.gameKeys.includes("jigsaw")) redirect("/live");
  const [{ variantId }, query] = await Promise.all([params, searchParams]);
  const mode = query.mode === "MATCH" ? "MATCH" : "SOLO"; const category = query.cat === "WITH_HINTS" ? "WITH_HINTS" : "NO_HINTS";
  return <WebGameBoundary><GameScreen component={SharedGame11} view="puzzleLeaderboard" data={{ "variantId": variantId, "initialMode": mode, "initialCategory": category }}  /></WebGameBoundary>;
}
