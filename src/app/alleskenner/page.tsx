import SharedGame2 from "@/components/alleskenner/AlleskennerSetupClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { canStartGame } from "@/lib/gameAvailability";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";


export default async function AlleskennerPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canStartGame(user.id, "alleskenner"))) redirect("/live?availability=unavailable");

  return <WebGameBoundary><GameScreen component={SharedGame2} view="alleskennerSetup" data={{  }}  /></WebGameBoundary>;
}
