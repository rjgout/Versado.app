import SharedGame13 from "@/components/puzzle/CoopClient";
import GameScreen from "@/components/games/GameScreen";
import WebGameBoundary from "@/components/games/WebGameBoundary";
import { gameRedirect as redirect } from "@/lib/games/navigation.server";
import { getCurrentUser } from "@/lib/session";
import { canResumeGameContent } from "@/lib/gameAvailability";
import { getCoopState } from "@/lib/puzzle/coop";
import { PuzzleServiceError } from "@/lib/puzzle/errors";


export default async function CoopPuzzlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!await canResumeGameContent("content_bom")) redirect("/live?availability=unavailable");
  const { id } = await params;
  let state: Awaited<ReturnType<typeof getCoopState>>;
  try {
    state = await getCoopState(user.id, id);
  } catch (error) {
    if (error instanceof PuzzleServiceError) redirect("/jigsaw");
    throw error;
  }
  return <WebGameBoundary><GameScreen component={SharedGame13} view="puzzleCoop" data={{ "initial": state, "meId": user.id }}  /></WebGameBoundary>;
}
