import SharedGame10 from "@/components/JigsawV2Client";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { prisma } from "@/lib/db";
import { canStartGame, canResumeGameContent } from "@/lib/gameAvailability";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { jigsawCatalog } from "@/lib/jigsawGame";

import { listCoopOverview } from "@/lib/puzzle/coop";
import { listMatchOverview } from "@/lib/puzzle/match";

export default async function JigsawPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const allowStarts = await canStartGame(user.id, "jigsaw");
  if (!allowStarts) {
    if (!await canResumeGameContent("content_bom")) redirect("/live?availability=unavailable");
    const [solo, coop, matches] = await Promise.all([
      prisma.puzzleSession.count({ where: { ownerId: user.id, mode: "SOLO", status: { in: ["ACTIVE", "COMPLETED"] } } }),
      listCoopOverview(user.id), listMatchOverview(user.id),
    ]);
    if (!solo && !coop.sessions.length && !coop.invites.length && !matches.length) redirect("/live?availability=unavailable");
  }
  return <WebGameBoundary><GameScreen component={SharedGame10} view="puzzleCatalogue" data={{ "images": jigsawCatalog, "allowStarts": allowStarts }}  /></WebGameBoundary>;
}
