import SharedGame27 from "@/components/WordSearchClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { getWordSearch } from "@/lib/wordSearch/game";


export default async function WordSearchGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const game = await getWordSearch(user.id, (await params).gameId);
  if (!game) redirect("/word-search");
  return <WebGameBoundary><GameScreen component={SharedGame27} view="wordSearch" data={{ "initialGame": game }}  /></WebGameBoundary>;
}
