import SharedGame27 from "@/components/WordSearchClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { assertWordSearchContext, getActiveWordSearch } from "@/lib/wordSearch/game";


export default async function WordSearchPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, context] = await Promise.all([getGameSettings(), assertWordSearchContext(user.id)]);
  const active = await getActiveWordSearch(user.id);
  if (!active && (!settings.wordSearchEnabled || !context)) redirect("/live?availability=unavailable");
  return <WebGameBoundary><GameScreen component={SharedGame27} view="wordSearch" data={{ "initialGame": active }}  /></WebGameBoundary>;
}
