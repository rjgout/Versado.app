import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { canResumeGameContent } from "@/lib/gameAvailability";
import { getCoopState } from "@/lib/puzzle/coop";
import { PuzzleServiceError } from "@/lib/puzzle/errors";
import CoopClient from "@/components/puzzle/CoopClient";

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
  return <CoopClient initial={state} meId={user.id} />;
}
