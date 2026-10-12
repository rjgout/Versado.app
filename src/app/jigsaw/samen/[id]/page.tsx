import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { getContentContext } from "@/lib/contentCollections";
import { getCoopState } from "@/lib/puzzle/coop";
import { PuzzleServiceError } from "@/lib/puzzle/errors";
import CoopClient from "@/components/puzzle/CoopClient";

export default async function CoopPuzzlePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  if ((!settings.jigsawEnabled && !user.isAdmin) || !context.gameKeys.includes("jigsaw")) redirect("/live");
  const { id } = await params;
  try {
    return <CoopClient initial={await getCoopState(user.id, id)} meId={user.id} />;
  } catch (error) {
    if (error instanceof PuzzleServiceError) redirect("/jigsaw");
    throw error;
  }
}
