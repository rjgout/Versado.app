import SharedGame19 from "@/components/LiveLobbyForm";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { getContentContext } from "@/lib/contentCollections";


export default async function LivePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, contentContext] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  return (
    <WebGameBoundary><div className="min-w-0 space-y-6">
    <GameScreen component={SharedGame19} view="hub" data={{ "settings": settings, "isAdmin": user.isAdmin, "allowedGameKeys": contentContext.gameKeys, "contentName": contentContext.active.name }}  />
    </div></WebGameBoundary>
  );
}
