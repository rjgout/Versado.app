import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canResumeGameContent } from "@/lib/gameAvailability";
import { getMatch } from "@/lib/puzzle/match";
import { PuzzleServiceError } from "@/lib/puzzle/errors";
import MatchClient from "@/components/puzzle/MatchClient";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!await canResumeGameContent("content_bom")) redirect("/live?availability=unavailable");
  const { id } = await params;
  let state: Awaited<ReturnType<typeof getMatch>>;
  try {
    state = await getMatch(user.id, id);
  } catch (error) {
    if (error instanceof PuzzleServiceError) redirect("/jigsaw");
    throw error;
  }
  return <MatchClient initial={state} meId={user.id} />;
}
