import SharedGame24 from "@/components/snelleZendeling/RunClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { companionToMascot } from "@/lib/companion";
import { prisma } from "@/lib/db";


export default async function QuickMissionaryRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const run = await prisma.quickMissionaryRun.findFirst({ where: { id: (await params).runId, userId: user.id }, select: { id: true } });
  if (!run) redirect("/live");
  return <WebGameBoundary><GameScreen component={SharedGame24} view="flightRun" data={{ "runId": (await params).runId, "character": companionToMascot(user.companion) }}  /></WebGameBoundary>;
}
