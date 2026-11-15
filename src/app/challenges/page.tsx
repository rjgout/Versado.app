import SharedGame5 from "@/components/ChallengesClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { Suspense } from "react";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";

import { getT } from "@/lib/i18n";

export default async function ChallengesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <WebGameBoundary><Suspense fallback={<p className="text-slate-400 dark:text-slate-500">{getT(user.uiLanguage)("common.loading")}</p>}>
      <GameScreen component={SharedGame5} view="challenges" data={{  }}  />
    </Suspense></WebGameBoundary>
  );
}
