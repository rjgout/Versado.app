import SharedGame4 from "@/components/alleskenner/SeasonListClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { canStartGame } from "@/lib/gameAvailability";


export default async function AlleskennerSeasonsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canStartGame(user.id, "alleskenner"))) redirect("/live?availability=unavailable");
  return <WebGameBoundary><GameScreen component={SharedGame4} view="alleskennerSeasons" data={{  }}  /></WebGameBoundary>;
}
