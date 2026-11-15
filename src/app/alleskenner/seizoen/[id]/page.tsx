import SharedGame3 from "@/components/alleskenner/SeasonClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";

import FocusLayout from "@/components/versado/FocusLayout";

export default async function AlleskennerSeasonPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const settings = await getGameSettings();
  if (!settings.alleskennerEnabled && !user.isAdmin) redirect("/live");
  const { id } = await params;
  return <WebGameBoundary><FocusLayout className="max-w-5xl"><GameScreen component={SharedGame3} view="alleskennerSeason" data={{ "id": id }}  /></FocusLayout></WebGameBoundary>;
}
