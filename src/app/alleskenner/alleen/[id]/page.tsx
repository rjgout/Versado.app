import SharedGame0 from "@/components/alleskenner/AlleskennerRoom";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";

import FocusLayout from "@/components/versado/FocusLayout";

export default async function AlleskennerSoloGamePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  return <WebGameBoundary><FocusLayout className="max-w-5xl"><GameScreen component={SharedGame0} view="alleskennerRoom" data={{ "code": `SOLO-${id}`, "soloRunId": id }}  /></FocusLayout></WebGameBoundary>;
}
