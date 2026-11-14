import SharedGame25 from "@/components/snelleZendeling/TogetherRoom";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { companionToMascot } from "@/lib/companion";

import { PLAY_ROUTE } from "@/lib/navigation";

// De lobby en de run van Samen spelen. Uitnodigingen verwijzen naar /live/<code>,
// dat voor deze spelmodus hierheen doorverwijst (zie src/app/live/[code]/page.tsx).
export default async function TogetherPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const code = (await params).code.toUpperCase();
  const game = await prisma.liveGame.findUnique({ where: { code }, select: { mode: true, hostId: true, players: { where: { userId: user.id }, select: { id: true } }, invites: { where: { userId: user.id }, select: { id: true } } } });
  if (!game || game.mode !== "QUICK_MISSIONARY" || (game.hostId !== user.id && !game.players.length && !game.invites.length)) redirect(PLAY_ROUTE);
  return <WebGameBoundary><GameScreen component={SharedGame25} view="flightTogether" data={{ "code": code, "myUserId": user.id, "character": companionToMascot(user.companion) }}  /></WebGameBoundary>;
}
