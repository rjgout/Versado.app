import SharedGame23 from "@/components/snelleZendeling/StartClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { canUseQuickMissionary } from "@/lib/snelleZendeling/access";


export default async function QuickMissionaryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canUseQuickMissionary(user.id, user.isAdmin))) redirect("/live?availability=unavailable");
  return <WebGameBoundary><GameScreen component={SharedGame23} view="flightStart" data={{  }}  /></WebGameBoundary>;
}
