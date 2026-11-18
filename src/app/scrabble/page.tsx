import SharedGame22 from "@/components/ScrabbleListClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { canStartGame } from "@/lib/gameAvailability";
import { Suspense } from "react";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";

import { getT } from "@/lib/i18n";

export default async function ScrabblePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <WebGameBoundary><Suspense fallback={<p className="text-slate-400 dark:text-slate-500">{getT(user.uiLanguage)("common.loading")}</p>}>
      <GameScreen component={SharedGame22} view="wordDuels" data={{ "allowStarts": await canStartGame(user.id, "scrabble") }}  />
    </Suspense></WebGameBoundary>
  );
}
