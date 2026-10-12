import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings } from "@/lib/gameSettings";
import { getContentContext } from "@/lib/contentCollections";
import { getMatch } from "@/lib/puzzle/match";
import { PuzzleServiceError } from "@/lib/puzzle/errors";
import MatchClient from "@/components/puzzle/MatchClient";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  if ((!settings.jigsawEnabled && !user.isAdmin) || !context.gameKeys.includes("jigsaw")) redirect("/live");
  const { id } = await params;
  try {
    return <MatchClient initial={await getMatch(user.id, id)} meId={user.id} />;
  } catch (error) {
    if (error instanceof PuzzleServiceError) redirect("/jigsaw");
    throw error;
  }
}
