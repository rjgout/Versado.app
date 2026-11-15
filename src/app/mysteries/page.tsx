import SharedGame20 from "@/components/mysteries/MysteryOverviewView";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";

import { hasMysteryAttempt } from "@/lib/mysteries/attempts";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { canUseMystery, getMysteryProgress } from "@/lib/mysteries/progress";
import { getCurrentUser } from "@/lib/session";
import { MYSTERY_GAME } from "@/lib/mysteries/game";

export default async function MysteryGamePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await hasMysteryAttempt(user.id)) && !(await canUseMystery(user.id, user.isAdmin))) redirect("/live?availability=unavailable");
  const progress = await Promise.all(MYSTERY_GAME.mysteries.map(({ definition }) => getMysteryProgress(user.id, definition)));

  return <WebGameBoundary><GameScreen component={SharedGame20} view="mysteryOverview" data={{ "progress": progress }}  /></WebGameBoundary>;
}
