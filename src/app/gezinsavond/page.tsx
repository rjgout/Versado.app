import SharedGame8 from "@/components/FamilyGameSetupClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { canStartGame } from "@/lib/gameAvailability";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";


export default async function GezinsavondPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canStartGame(user.id, "gezinsavond"))) redirect("/live?availability=unavailable");
  return <WebGameBoundary><GameScreen component={SharedGame8} view="familySetup" data={{  }}  /></WebGameBoundary>;
}
