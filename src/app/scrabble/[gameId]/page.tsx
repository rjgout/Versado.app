import SharedGame21 from "@/components/ScrabbleBoardClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";


export default async function ScrabbleGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { gameId } = await params;
  return <WebGameBoundary><GameScreen component={SharedGame21} view="wordDuel" data={{ "gameId": gameId }}  /></WebGameBoundary>;
}
