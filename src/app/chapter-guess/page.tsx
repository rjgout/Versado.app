import { canStartGame } from "@/lib/gameAvailability";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import ChapterGuessSetupClient from "@/components/ChapterGuessSetupClient";

export default async function ChapterGuessPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!(await canStartGame(user.id, "chapter-guess"))) redirect("/live?availability=unavailable");
  const availableQuestionCounts = (await Promise.all([5, 10, 15].map(async count => await canStartGame(user.id, "chapter-guess", count) ? count : null))).filter((n): n is number => n !== null);
  return <ChapterGuessSetupClient availableQuestionCounts={availableQuestionCounts} />;
}
